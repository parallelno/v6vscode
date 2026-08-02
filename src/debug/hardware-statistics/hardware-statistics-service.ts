import { EventEmitter } from 'events';
import { IpcClient } from '../../emulator/client/ipc-client';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { IpcCommand, IpcResponse } from '../../emulator/protocol/ipc-commands';
import { validateHardwareStatisticsServer } from '../../emulator/protocol/ipc-server-info';
import {
    decodeHardwarePorts,
    decodeHardwareStatistics,
    DismountFddResponse,
    HardwarePortsSnapshot,
    HardwareStatisticsSnapshot,
    SetPaletteEntryResponse,
} from './hardware-statistics-model';

export type PortDirection = 'in' | 'out';

export interface HardwareStatisticsState {
    generation: number;
    snapshot?: HardwareStatisticsSnapshot;
    ports: Partial<Record<PortDirection, HardwarePortsSnapshot>>;
    portErrors: Partial<Record<PortDirection, string>>;
    synchronizing: boolean;
}

export class HardwareStatisticsService extends EventEmitter {
    private generation = 0;
    private visible = false;
    private snapshotValue: HardwareStatisticsSnapshot | undefined;
    private readonly portsValue: Partial<Record<PortDirection, HardwarePortsSnapshot>> = {};
    private readonly portErrorsValue: Partial<Record<PortDirection, string>> = {};
    private readonly expanded = new Set<PortDirection>();
    private refreshPromise: Promise<void> | undefined;
    private synchronizing = false;
    private mutationQueue: Promise<void> = Promise.resolve();
    private readonly stateListener: (state: string) => void;

    constructor(
        private readonly lifecycle: EmulatorLifecycle,
        private readonly client: IpcClient,
    ) {
        super();
        this.stateListener = state => {
            if (state === 'stopped') {
                this.generation++;
                this.synchronizing = false;
                this.snapshotValue = undefined;
                delete this.portsValue.in;
                delete this.portsValue.out;
                delete this.portErrorsValue.in;
                delete this.portErrorsValue.out;
                this.emitChange();
            } else if (state === 'connected' && this.visible && this.available) {
                void this.refresh().catch(() => {});
            } else {
                this.emitChange();
            }
        };
        this.lifecycle.on('stateChange', this.stateListener);
    }

    get available(): boolean {
        const info = this.lifecycle.serverInfo;
        if (!info) { return false; }
        try {
            validateHardwareStatisticsServer(info);
            return true;
        } catch {
            return false;
        }
    }

    get sessionGeneration(): number { return this.generation; }

    get state(): HardwareStatisticsState {
        return {
            generation: this.generation,
            snapshot: this.snapshotValue,
            ports: { ...this.portsValue },
            portErrors: { ...this.portErrorsValue },
            synchronizing: this.synchronizing,
        };
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (visible && this.lifecycle.connected && !this.lifecycle.running && this.available) {
            void this.refresh().catch(() => {});
        }
    }

    setPortExpanded(direction: PortDirection, expanded: boolean): void {
        if (expanded) this.expanded.add(direction);
        else this.expanded.delete(direction);
        if (expanded && this.visible && this.lifecycle.connected && !this.lifecycle.running && this.available) {
            void this.refreshPorts(direction).catch(() => {});
        }
    }

    async refresh(): Promise<void> {
        if (!this.visible || !this.lifecycle.connected || this.lifecycle.running) { return; }
        if (!this.available) { throw new Error('The active v6emul does not support hardware statistics schema 1'); }
        if (this.refreshPromise) { return this.refreshPromise; }
        this.refreshPromise = this.executeRefresh();
        try {
            await this.refreshPromise;
        } finally {
            this.refreshPromise = undefined;
        }
    }

    async setPaletteEntry(index: number, hwColor: number): Promise<void> {
        if (!Number.isInteger(index) || index < 0 || index > 15
            || !Number.isInteger(hwColor) || hwColor < 0 || hwColor > 0xFF) {
            throw new Error('Palette index or color is outside its valid range');
        }
        await this.mutate(async () => {
            const response = await this.client.send<SetPaletteEntryResponse>(
                IpcCommand.SET_IO_PALETTE_ENTRY, { index, hwColor }, 5000, 'high',
            );
            this.requireData(response, 'SET_IO_PALETTE_ENTRY');
            await this.refreshSnapshot();
            if (this.snapshotValue?.palette[index] !== hwColor) {
                throw new Error('Palette update could not be verified');
            }
        });
    }

    async mountDrive(driveIdx: number, data: readonly number[], path: string): Promise<void> {
        this.validateDrive(driveIdx);
        await this.mutate(async () => {
            const response = await this.client.send(
                IpcCommand.MOUNT_FDD, { data, driveIdx, path, autoBoot: false }, 5000, 'high',
            );
            this.requireOk(response, 'MOUNT_FDD');
            await this.refreshSnapshot();
            const drive = this.snapshotValue?.fdc.drives[driveIdx];
            if (!drive?.mounted || drive.path !== path) {
                throw new Error('FDD mount could not be verified');
            }
        });
    }

    async dismountDrive(driveIdx: number): Promise<void> {
        this.validateDrive(driveIdx);
        await this.mutate(async () => {
            const response = await this.client.send<DismountFddResponse>(
                IpcCommand.DISMOUNT_FDD, { driveIdx }, 5000, 'high',
            );
            this.requireData(response, 'DISMOUNT_FDD');
            await this.refreshSnapshot();
            const drive = this.snapshotValue?.fdc.drives[driveIdx];
            if (!drive || drive.mounted || drive.path !== '') {
                throw new Error('FDD dismount could not be verified');
            }
        });
    }

    dispose(): void {
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.removeAllListeners();
    }

    private async executeRefresh(): Promise<void> {
        this.synchronizing = true;
        this.emitChange();
        const generation = this.generation;
        try {
            await this.refreshSnapshot(generation);
            await Promise.all([...this.expanded].map(direction => this.refreshPorts(direction, this.generation)));
        } finally {
            this.synchronizing = false;
            this.emitChange();
        }
    }

    private async refreshSnapshot(generation = this.generation): Promise<void> {
        const response = await this.client.send<unknown>(IpcCommand.GET_HARDWARE_STATS, undefined, 5000, 'high');
        const data = this.requireData(response, 'GET_HARDWARE_STATS');
        let snapshot = decodeHardwareStatistics(data);
        if (generation !== this.generation || !this.visible || !this.lifecycle.connected) { return; }
        if (this.snapshotValue && snapshot.sessionId !== this.snapshotValue.sessionId) {
            this.generation++;
            generation = this.generation;
            delete this.portsValue.in;
            delete this.portsValue.out;
        } else if (this.snapshotValue && snapshot.cpuCycles > this.snapshotValue.cpuCycles) {
            snapshot = {
                ...snapshot,
                lastRunCycles: snapshot.cpuCycles - this.snapshotValue.cpuCycles,
            };
        }
        this.snapshotValue = snapshot;
        this.emitChange();
    }

    private async refreshPorts(direction: PortDirection, generation = this.generation): Promise<void> {
        if (!this.visible || !this.expanded.has(direction) || this.lifecycle.running) { return; }
        const command = direction === 'in' ? IpcCommand.GET_IO_PORTS_IN_DATA : IpcCommand.GET_IO_PORTS_OUT_DATA;
        try {
            const response = await this.client.send<unknown>(command, undefined, 5000, 'normal');
            const data = this.requireData(response, command === IpcCommand.GET_IO_PORTS_IN_DATA
                ? 'GET_IO_PORTS_IN_DATA' : 'GET_IO_PORTS_OUT_DATA');
            const ports = decodeHardwarePorts(data, direction);
            if (generation !== this.generation || !this.visible || !this.expanded.has(direction)) { return; }
            this.portsValue[direction] = ports;
            delete this.portErrorsValue[direction];
        } catch (error) {
            if (generation === this.generation && this.visible && this.expanded.has(direction)) {
                this.portErrorsValue[direction] = error instanceof Error ? error.message : String(error);
            }
        }
        this.emitChange();
    }

    private async mutate(operation: () => Promise<void>): Promise<void> {
        const pending = this.mutationQueue.then(async () => {
            if (!this.visible || !this.lifecycle.connected || this.lifecycle.running) {
                throw new Error('Hardware mutations require a visible, stopped emulator session');
            }
            if (!this.available) { throw new Error('Hardware statistics mutations are unavailable'); }
            await operation();
        });
        this.mutationQueue = pending.catch(() => {});
        return pending;
    }

    private requireData<T>(response: IpcResponse<T>, command: string): T {
        this.requireOk(response, command);
        if (response.data === undefined) { throw new Error(`${command} returned no data`); }
        return response.data;
    }

    private requireOk(response: IpcResponse, command: string): void {
        if (!response.ok) {
            throw new Error(`${command} failed (${response.code ?? 'unknown_error'}): ${response.error ?? 'unknown error'}`);
        }
    }

    private validateDrive(driveIdx: number): void {
        if (!Number.isInteger(driveIdx) || driveIdx < 0 || driveIdx > 3) {
            throw new Error('Drive index must be in the range 0..3');
        }
    }

    private emitChange(): void { this.emit('change', this.state); }
}