import { EventEmitter } from 'events';
import { IpcClient } from '../../emulator/client/ipc-client';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { CodePerfInput, CodePerfLimits, CodePerfSnapshot } from '../../emulator/protocol/debug-models';
import { GetServerInfoResponse, IpcCommand, IpcResponse } from '../../emulator/protocol/ipc-commands';
import { validatePerformanceServer } from '../../emulator/protocol/ipc-server-info';
import { decodeCodePerfSnapshot, decodeCodePerfSnapshots, validateCodePerfInput } from './performance-codec';

export class PerformanceService extends EventEmitter {
    private entries: readonly CodePerfSnapshot[] = [];
    private queue: Promise<void> = Promise.resolve();
    private refreshInFlight: Promise<readonly CodePerfSnapshot[]> | undefined;
    private generation = 0;
    private readonly stateListener: () => void;

    constructor(
        private readonly lifecycle: EmulatorLifecycle,
        private readonly client: IpcClient,
    ) {
        super();
        this.stateListener = () => {
            if (!this.lifecycle.connected) { this.reset(); }
        };
        this.lifecycle.on('stateChange', this.stateListener);
    }

    get snapshot(): readonly CodePerfSnapshot[] { return this.entries; }
    get sessionGeneration(): number { return this.generation; }

    get available(): boolean {
        try {
            this.requireAvailable();
            return true;
        } catch { return false; }
    }

    refresh(): Promise<readonly CodePerfSnapshot[]> {
        if (this.refreshInFlight) { return this.refreshInFlight; }
        const refresh = this.enqueue(() => this.refreshNow());
        this.refreshInFlight = refresh;
        void refresh.then(
            () => { if (this.refreshInFlight === refresh) { this.refreshInFlight = undefined; } },
            () => { if (this.refreshInFlight === refresh) { this.refreshInFlight = undefined; } },
        );
        return refresh;
    }

    add(input: CodePerfInput): Promise<CodePerfSnapshot> {
        return this.mutate(async () => {
            try {
                const request = this.validate(input);
                const response = await this.client.send<unknown>(
                    IpcCommand.DEBUG_CODE_PERF_ADD, request, 5000, 'high',
                );
                const created = decodeCodePerfSnapshot(
                    this.responseData(response, 'Unable to add performance test'), this.limits(),
                );
                if (!matches(created, request) || created.averageClockCycles !== 0 || created.testCount !== 0) {
                    throw new Error('Added performance test does not match the acknowledged input');
                }
                await this.refreshNow();
                return this.requireEntry(created.id);
            } catch (error) {
                return this.reconcileFailure(error);
            }
        });
    }

    edit(id: number, input: CodePerfInput): Promise<CodePerfSnapshot> {
        return this.mutate(async () => {
            try {
                const existing = this.requireEntry(id);
                const request = this.validate(input);
                const response = await this.client.send<unknown>(
                    IpcCommand.DEBUG_CODE_PERF_EDIT, { id: existing.id, ...request }, 5000, 'high',
                );
                const edited = decodeCodePerfSnapshot(
                    this.responseData(response, 'Unable to edit performance test'), this.limits(),
                );
                if (edited.id !== id || !matches(edited, request)) {
                    throw new Error(`Edited performance test ${id} does not match the acknowledged input`);
                }
                await this.refreshNow();
                return this.requireMatching(id, request);
            } catch (error) {
                return this.reconcileFailure(error);
            }
        });
    }

    disable(id: number): Promise<CodePerfSnapshot> {
        return this.setActivity(id, false);
    }

    setActivity(id: number, active: boolean): Promise<CodePerfSnapshot> {
        return this.mutate(async () => {
            try {
                const entry = this.requireEntry(id);
                const request = this.validate(inputFrom(entry, { active }));
                const response = await this.client.send<unknown>(
                    IpcCommand.DEBUG_CODE_PERF_EDIT, { id: entry.id, ...request }, 5000, 'high',
                );
                const edited = decodeCodePerfSnapshot(
                    this.responseData(response, 'Unable to change performance test activity'), this.limits(),
                );
                if (edited.id !== id || !matches(edited, request)) {
                    throw new Error(`Performance test ${id} activity was not acknowledged`);
                }
                await this.refreshNow();
                return this.requireMatching(id, request);
            } catch (error) {
                return this.reconcileFailure(error);
            }
        });
    }

    disableAll(): Promise<void> {
        return this.mutate(async () => {
            try {
                for (const entry of this.entries.filter(item => item.active)) {
                    const request = this.validate(inputFrom(entry, { active: false }));
                    const response = await this.client.send<unknown>(
                        IpcCommand.DEBUG_CODE_PERF_EDIT, { id: entry.id, ...request }, 5000, 'high',
                    );
                    const edited = decodeCodePerfSnapshot(
                        this.responseData(response, `Unable to disable performance test ${entry.id}`), this.limits(),
                    );
                    if (edited.id !== entry.id || !matches(edited, request)) {
                        throw new Error(`Disabled performance test ${entry.id} was not acknowledged`);
                    }
                }
            } finally {
                await this.refreshNow();
            }
            if (this.entries.some(entry => entry.active)) { throw new Error('Not all performance tests were disabled'); }
        });
    }

    delete(id: number): Promise<void> {
        return this.mutate(async () => {
            this.requireEntry(id);
            await this.sendMutation(IpcCommand.DEBUG_CODE_PERF_DEL, { id });
            await this.refreshNow();
            if (this.find(id)) { throw new Error(`Performance test ${id} was not deleted`); }
        });
    }

    deleteAll(): Promise<void> {
        return this.mutate(async () => {
            await this.sendMutation(IpcCommand.DEBUG_CODE_PERF_DEL_ALL, {});
            await this.refreshNow();
            if (this.entries.length) { throw new Error('Not all performance tests were deleted'); }
        });
    }

    dispose(): void {
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.removeAllListeners();
    }

    private async refreshNow(): Promise<readonly CodePerfSnapshot[]> {
        const limits = this.limits();
        const generation = this.generation;
        const response = await this.client.send<unknown>(
            IpcCommand.DEBUG_CODE_PERF_GET_ALL, {}, 5000, 'normal',
        );
        if (generation !== this.generation) { throw new Error('Performance response belongs to an inactive connection'); }
        const entries = decodeCodePerfSnapshots(
            this.responseData(response, 'Unable to list performance tests'), limits,
        );
        this.entries = Object.freeze(entries.map(entry => Object.freeze(entry)));
        this.emit('change', this.entries);
        return this.entries;
    }

    private mutate<T>(operation: () => Promise<T>): Promise<T> {
        return this.enqueue(async () => {
            this.requireAvailable();
            return operation();
        });
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.queue.then(operation);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async sendMutation(command: IpcCommand, data?: unknown): Promise<void> {
        const response = await this.client.send(command, data, 5000, 'high');
        if (!response.ok) { throw new Error(protocolError(response, `Performance command ${command} failed`)); }
    }

    private responseData<T>(response: IpcResponse<T>, fallback: string): T {
        if (!response.ok || response.data === undefined) { throw new Error(protocolError(response, fallback)); }
        return response.data;
    }

    private async reconcileFailure(error: unknown): Promise<never> {
        try { await this.refreshNow(); } catch { /* Preserve the original mutation failure. */ }
        throw error;
    }

    private find(id: number): CodePerfSnapshot | undefined {
        return this.entries.find(entry => entry.id === id);
    }

    private requireEntry(id: number): CodePerfSnapshot {
        const entry = this.find(id);
        if (!entry) { throw new Error(`Performance test ${id} no longer exists`); }
        return entry;
    }

    private requireMatching(id: number, input: CodePerfInput): CodePerfSnapshot {
        const entry = this.requireEntry(id);
        if (!matches(entry, input)) { throw new Error(`Performance test ${id} does not match the acknowledged input`); }
        return entry;
    }

    private validate(input: unknown): CodePerfInput {
        return validateCodePerfInput(input, this.limits());
    }

    private limits(): CodePerfLimits {
        return this.requireAvailable().capabilities.codePerfLimits!;
    }

    private requireAvailable(): GetServerInfoResponse {
        const info = this.lifecycle.serverInfo;
        if (!this.lifecycle.connected || !info) { throw new Error('No active emulator session'); }
        validatePerformanceServer(info);
        return info;
    }

    private reset(): void {
        this.generation++;
        this.entries = Object.freeze([]);
        this.emit('change', this.entries);
    }
}

function protocolError(response: IpcResponse, fallback: string): string {
    const base = response.error ?? fallback;
    if (response.details?.field === 'collection' && response.details?.reason === 'capacity') {
        return `${base}: deleting a record can free capacity`;
    }
    if (response.details?.field === 'collection' && response.details?.reason === 'id_exhausted') {
        return `${base}: no further IDs can be allocated during this collection lifetime`;
    }
    const field = typeof response.details?.field === 'string' ? ` (${response.details.field})` : '';
    const reason = typeof response.details?.reason === 'string' ? `: ${response.details.reason}` : '';
    return `${base}${field}${reason}`;
}

function inputFrom(entry: CodePerfSnapshot, changes: Partial<CodePerfInput>): CodePerfInput {
    return {
        name: entry.name,
        addrStart: entry.addrStart,
        addrEnd: entry.addrEnd,
        active: entry.active,
        ...changes,
    };
}

function matches(entry: CodePerfSnapshot, input: CodePerfInput): boolean {
    return entry.name === input.name
        && entry.addrStart === input.addrStart
        && entry.addrEnd === input.addrEnd
        && entry.active === input.active;
}