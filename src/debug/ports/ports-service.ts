import { EventEmitter } from 'events';
import { IpcClient } from '../../emulator/client/ipc-client';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { IpcCommand, IpcResponse } from '../../emulator/protocol/ipc-commands';
import { decodePorts } from './ports-model';

export type PortDirection = 'in' | 'out';

export interface PortsState {
    generation: number;
    ports: Partial<Record<PortDirection, readonly number[]>>;
    changed: Partial<Record<PortDirection, readonly number[]>>;
    errors: Partial<Record<PortDirection, string>>;
    synchronizing: boolean;
}

export class PortsService extends EventEmitter {
    private generation = 0;
    private visible = false;
    private readonly portsValue: Partial<Record<PortDirection, readonly number[]>> = {};
    private readonly changedValue: Partial<Record<PortDirection, readonly number[]>> = {};
    private readonly errorsValue: Partial<Record<PortDirection, string>> = {};
    private synchronizing = false;
    private refreshPromise: Promise<void> | undefined;
    private readonly stateListener: (state: string) => void;

    constructor(
        private readonly lifecycle: EmulatorLifecycle,
        private readonly client: IpcClient,
    ) {
        super();
        this.stateListener = state => {
            if (state === 'stopped') {
                this.generation++;
                this.clear();
            } else if (state === 'connected' && this.visible && this.available) {
                void this.refresh().catch(() => {});
            } else {
                this.emitChange();
            }
        };
        this.lifecycle.on('stateChange', this.stateListener);
    }

    get available(): boolean {
        const commands = this.lifecycle.serverInfo?.commands;
        return Array.isArray(commands)
            && commands.includes(IpcCommand.GET_IO_PORTS_IN_DATA)
            && commands.includes(IpcCommand.GET_IO_PORTS_OUT_DATA);
    }

    get state(): PortsState {
        return {
            generation: this.generation,
            ports: { ...this.portsValue },
            changed: { ...this.changedValue },
            errors: { ...this.errorsValue },
            synchronizing: this.synchronizing,
        };
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        if (visible && this.lifecycle.connected && !this.lifecycle.running && this.available) {
            void this.refresh().catch(() => {});
        }
    }

    async refresh(): Promise<void> {
        if (!this.visible || !this.lifecycle.connected || this.lifecycle.running) { return; }
        if (!this.available) { throw new Error('The active v6emul does not support bulk port statistics'); }
        if (this.refreshPromise) { return this.refreshPromise; }
        this.refreshPromise = this.executeRefresh();
        try {
            await this.refreshPromise;
        } finally {
            this.refreshPromise = undefined;
        }
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
            await Promise.all([
                this.refreshDirection('in', generation),
                this.refreshDirection('out', generation),
            ]);
        } finally {
            this.synchronizing = false;
            this.emitChange();
        }
    }

    private async refreshDirection(direction: PortDirection, generation: number): Promise<void> {
        const command = direction === 'in' ? IpcCommand.GET_IO_PORTS_IN_DATA : IpcCommand.GET_IO_PORTS_OUT_DATA;
        try {
            const response = await this.client.send<unknown>(command, undefined, 5000, 'normal');
            const data = this.requireData(response, direction === 'in' ? 'GET_IO_PORTS_IN_DATA' : 'GET_IO_PORTS_OUT_DATA');
            const next = decodePorts(data, direction).bytes;
            if (generation !== this.generation || !this.visible || !this.lifecycle.connected || this.lifecycle.running) { return; }
            const previous = this.portsValue[direction];
            this.changedValue[direction] = previous
                ? next.flatMap((value, index) => value === previous[index] ? [] : [index])
                : [];
            this.portsValue[direction] = next;
            delete this.errorsValue[direction];
        } catch (error) {
            if (generation === this.generation && this.visible && !this.lifecycle.running) {
                this.errorsValue[direction] = error instanceof Error ? error.message : String(error);
            }
        }
    }

    private requireData<T>(response: IpcResponse<T>, command: string): T {
        if (!response.ok) {
            throw new Error(`${command} failed (${response.code ?? 'unknown_error'}): ${response.error ?? 'unknown error'}`);
        }
        if (response.data === undefined) { throw new Error(`${command} returned no data`); }
        return response.data;
    }

    private clear(): void {
        this.synchronizing = false;
        delete this.portsValue.in;
        delete this.portsValue.out;
        delete this.changedValue.in;
        delete this.changedValue.out;
        delete this.errorsValue.in;
        delete this.errorsValue.out;
        this.emitChange();
    }

    private emitChange(): void { this.emit('change', this.state); }
}