import { EventEmitter } from 'events';
import { decodeProtocolData, requireProtocolOk, ProtocolError } from '../../emulator/protocol/protocol-result';
import { CommandTransport, SessionOperations, SessionOperation, SessionState } from '../../emulator/session/session-operations';
import { CodePerfInput, CodePerfLimits, CodePerfSnapshot } from '../../emulator/protocol/debug-models';
import { GetServerInfoResponse, IpcCommand } from '../../emulator/protocol/ipc-commands';
import { validatePerformanceServer } from '../../emulator/protocol/ipc-server-info';
import { decodeCodePerfSnapshot, decodeCodePerfSnapshots, validateCodePerfInput } from './performance-codec';

export interface PerformanceEvents { change: [entries: readonly CodePerfSnapshot[]] }
export class PerformanceService extends EventEmitter<PerformanceEvents> {
    private entries: readonly CodePerfSnapshot[] = [];
    private readonly operations: SessionOperations<readonly CodePerfSnapshot[]>;

    constructor(
        private readonly lifecycle: SessionState,
        client: CommandTransport,
    ) {
        super();
        this.operations = new SessionOperations<readonly CodePerfSnapshot[]>(lifecycle, client, () => this.reset());
    }

    get snapshot(): readonly CodePerfSnapshot[] { return this.entries; }
    get sessionGeneration(): number { return this.operations.generation; }

    get available(): boolean {
        try {
            this.requireAvailable();
            return true;
        } catch { return false; }
    }

    refresh(): Promise<readonly CodePerfSnapshot[]> {
        return this.operations.refresh(scope => this.refreshNow(scope));
    }

    add(input: CodePerfInput): Promise<CodePerfSnapshot> {
        return this.mutate(async scope => {
            try {
                const request = this.validate(scope, input);
                const response = await scope.send<unknown>(
                    IpcCommand.DEBUG_CODE_PERF_ADD, request, 5000, 'high',
                );
                const created = decodeProtocolData(IpcCommand.DEBUG_CODE_PERF_ADD, response, 'Unable to add performance test',
                    data => decodeCodePerfSnapshot(data, this.limits(scope)));
                if (!matches(created, request) || created.averageClockCycles !== 0 || created.testCount !== 0) {
                    throw new Error('Added performance test does not match the acknowledged input');
                }
                await this.refreshNow(scope);
                return this.requireEntry(created.id);
            } catch (error) {
                return this.reconcileFailure(scope, error);
            }
        });
    }

    edit(id: number, input: CodePerfInput): Promise<CodePerfSnapshot> {
        return this.mutate(async scope => {
            try {
                const existing = this.requireEntry(id);
                const request = this.validate(scope, input);
                const response = await scope.send<unknown>(
                    IpcCommand.DEBUG_CODE_PERF_EDIT, { id: existing.id, ...request }, 5000, 'high',
                );
                const edited = decodeProtocolData(IpcCommand.DEBUG_CODE_PERF_EDIT, response, 'Unable to edit performance test',
                    data => decodeCodePerfSnapshot(data, this.limits(scope)));
                if (edited.id !== id || !matches(edited, request)) {
                    throw new Error(`Edited performance test ${id} does not match the acknowledged input`);
                }
                await this.refreshNow(scope);
                return this.requireMatching(id, request);
            } catch (error) {
                return this.reconcileFailure(scope, error);
            }
        });
    }

    disable(id: number): Promise<CodePerfSnapshot> {
        return this.setActivity(id, false);
    }

    setActivity(id: number, active: boolean): Promise<CodePerfSnapshot> {
        return this.mutate(async scope => {
            try {
                const entry = this.requireEntry(id);
                const request = this.validate(scope, inputFrom(entry, { active }));
                const response = await scope.send<unknown>(
                    IpcCommand.DEBUG_CODE_PERF_EDIT, { id: entry.id, ...request }, 5000, 'high',
                );
                const edited = decodeProtocolData(IpcCommand.DEBUG_CODE_PERF_EDIT, response, 'Unable to change performance test activity',
                    data => decodeCodePerfSnapshot(data, this.limits(scope)));
                if (edited.id !== id || !matches(edited, request)) {
                    throw new Error(`Performance test ${id} activity was not acknowledged`);
                }
                await this.refreshNow(scope);
                return this.requireMatching(id, request);
            } catch (error) {
                return this.reconcileFailure(scope, error);
            }
        });
    }

    disableAll(): Promise<void> {
        return this.mutate(async scope => {
            try {
                for (const entry of this.entries.filter(item => item.active)) {
                    const request = this.validate(scope, inputFrom(entry, { active: false }));
                    const response = await scope.send<unknown>(
                        IpcCommand.DEBUG_CODE_PERF_EDIT, { id: entry.id, ...request }, 5000, 'high',
                    );
                    const edited = decodeProtocolData(IpcCommand.DEBUG_CODE_PERF_EDIT, response, `Unable to disable performance test ${entry.id}`,
                        data => decodeCodePerfSnapshot(data, this.limits(scope)));
                    if (edited.id !== entry.id || !matches(edited, request)) {
                        throw new Error(`Disabled performance test ${entry.id} was not acknowledged`);
                    }
                }
            } finally {
                await this.refreshNow(scope);
            }
            if (this.entries.some(entry => entry.active)) { throw new Error('Not all performance tests were disabled'); }
        });
    }

    delete(id: number): Promise<void> {
        return this.mutate(async scope => {
            this.requireEntry(id);
            await this.sendMutation(scope, IpcCommand.DEBUG_CODE_PERF_DEL, { id });
            await this.refreshNow(scope);
            if (this.find(id)) { throw new Error(`Performance test ${id} was not deleted`); }
        });
    }

    deleteAll(): Promise<void> {
        return this.mutate(async scope => {
            await this.sendMutation(scope, IpcCommand.DEBUG_CODE_PERF_DEL_ALL, {});
            await this.refreshNow(scope);
            if (this.entries.length) { throw new Error('Not all performance tests were deleted'); }
        });
    }

    dispose(): void {
        this.operations.dispose();
        this.removeAllListeners();
    }

    private async refreshNow(scope: SessionOperation): Promise<readonly CodePerfSnapshot[]> {
        const limits = this.limits(scope);
        scope.assertCurrent();
        const response = await scope.send<unknown>(
            IpcCommand.DEBUG_CODE_PERF_GET_ALL, {}, 5000, 'normal',
        );
        scope.assertCurrent();
        const entries = decodeProtocolData(IpcCommand.DEBUG_CODE_PERF_GET_ALL, response, 'Unable to list performance tests',
            data => decodeCodePerfSnapshots(data, limits));
        this.entries = Object.freeze(entries.map(entry => Object.freeze(entry)));
        this.emit('change', this.entries);
        return this.entries;
    }

    private mutate<T>(operation: (scope: SessionOperation) => Promise<T>): Promise<T> {
        return this.operations.enqueue(async scope => {
            this.requireAvailable(scope);
            return operation(scope);
        });
    }

    private async sendMutation(scope: SessionOperation, command: IpcCommand, data?: unknown): Promise<void> {
        const response = await scope.send(command, data, 5000, 'high');
        requireProtocolOk(command, response, `Performance command ${command} failed`);
    }

    private async reconcileFailure(scope: SessionOperation, error: unknown): Promise<never> {
        try { await this.refreshNow(scope); } catch { /* Preserve the original mutation failure. */ }
        if (error instanceof ProtocolError && error.field === 'collection') {
            if (error.reason === 'capacity') { error.message += ': deleting a record can free capacity'; }
            if (error.reason === 'id_exhausted') { error.message += ': no further IDs can be allocated during this collection lifetime'; }
        }
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

    private validate(scope: SessionOperation, input: unknown): CodePerfInput {
        return validateCodePerfInput(input, this.limits(scope));
    }

    private limits(scope: SessionOperation): CodePerfLimits {
        return this.requireAvailable(scope).capabilities.codePerfLimits!;
    }

    private requireAvailable(scope?: SessionOperation): GetServerInfoResponse {
        scope?.assertCurrent();
        const info = scope?.info ?? this.operations.capture().info;
        if (!this.lifecycle.connected || !info) { throw new Error('No active emulator session'); }
        validatePerformanceServer(info);
        return info;
    }

    private reset(): void {
        this.entries = Object.freeze([]);
        this.emit('change', this.entries);
    }
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