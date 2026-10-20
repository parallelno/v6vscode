import { EventEmitter } from 'events';
import { decodeProtocolData, requireProtocolOk } from '../../emulator/protocol/protocol-result';
import { CommandTransport, SessionOperations, SessionOperation, SessionState } from '../../emulator/session/session-operations';
import {
    MemoryEditInput,
    MemoryEditSnapshot,
} from '../../emulator/protocol/debug-models';
import { GetServerInfoResponse, IpcCommand } from '../../emulator/protocol/ipc-commands';
import { validateMemoryEditServer } from '../../emulator/protocol/ipc-server-info';
import {
    decodeMemoryEditList, decodeMemoryEditRestore,
    MemoryEditValidationLimits,
    validateMemoryEditInput,
} from './memory-edit-codec';

export interface MemoryEditEvents { change: [entries: readonly MemoryEditSnapshot[]] }
export class MemoryEditService extends EventEmitter<MemoryEditEvents> {
    private entries: readonly MemoryEditSnapshot[] = [];
    private readonly operations: SessionOperations<readonly MemoryEditSnapshot[]>;

    constructor(
        private readonly lifecycle: SessionState,
        client: CommandTransport,
    ) {
        super();
        this.operations = new SessionOperations<readonly MemoryEditSnapshot[]>(lifecycle, client, () => this.reset());
    }

    get snapshot(): readonly MemoryEditSnapshot[] { return this.entries; }
    get sessionGeneration(): number { return this.operations.generation; }

    get available(): boolean {
        try {
            this.requireAvailable();
            return true;
        } catch { return false; }
    }

    refresh(): Promise<readonly MemoryEditSnapshot[]> {
        return this.operations.refresh(scope => this.refreshNow(scope));
    }

    apply(globalAddr: number, enteredValue: number, currentValue?: number): Promise<MemoryEditSnapshot | undefined> {
        return this.mutate(async scope => {
            const existing = this.find(globalAddr);
            const request = this.validate(scope, {
                globalAddr,
                enteredValue,
                readonly: existing?.readonly ?? false,
                active: true,
                comment: existing?.comment ?? '',
            });
            if (!existing && request.enteredValue === currentValue) { return undefined; }
            await this.sendMutation(scope, IpcCommand.DEBUG_MEMORY_EDIT_ADD, request);
            await this.refreshNow(scope);
            return this.requireMatching(request);
        });
    }

    setAutoUpdate(globalAddr: number, enabled: boolean): Promise<MemoryEditSnapshot> {
        return this.update(globalAddr, entry => inputFrom(entry, { readonly: enabled, active: true }));
    }

    setEnteredValue(globalAddr: number, enteredValue: number): Promise<MemoryEditSnapshot> {
        return this.update(globalAddr, entry => inputFrom(entry, { enteredValue, active: true }));
    }

    setActivity(globalAddr: number, active: boolean): Promise<MemoryEditSnapshot> {
        return this.update(globalAddr, entry => inputFrom(entry, { active }));
    }

    disable(globalAddr: number): Promise<MemoryEditSnapshot> {
        return this.setActivity(globalAddr, false);
    }

    disableAll(): Promise<void> {
        return this.mutate(async scope => {
            for (const entry of this.entries.filter(item => item.active)) {
                await this.sendMutation(scope,
                    IpcCommand.DEBUG_MEMORY_EDIT_ADD,
                    this.validate(scope, inputFrom(entry, { active: false })),
                );
            }
            await this.refreshNow(scope);
            if (this.entries.some(entry => entry.active)) { throw new Error('Not all memory edits were disabled'); }
        });
    }

    delete(globalAddr: number): Promise<void> {
        return this.mutate(async scope => {
            this.requireEntry(globalAddr);
            await this.sendMutation(scope, IpcCommand.DEBUG_MEMORY_EDIT_DEL, { globalAddr });
            await this.refreshNow(scope);
            if (this.find(globalAddr)) { throw new Error(`Memory edit ${globalAddr} was not deleted`); }
        });
    }

    deleteAll(): Promise<void> {
        return this.mutate(async scope => {
            await this.sendMutation(scope, IpcCommand.DEBUG_MEMORY_EDIT_DEL_ALL);
            await this.refreshNow(scope);
            if (this.entries.length) { throw new Error('Not all memory edits were deleted'); }
        });
    }

    deleteAndRestore(globalAddr: number): Promise<void> {
        return this.mutate(async scope => {
            const entry = this.requireEntry(globalAddr);
            await this.restoreAndDelete(scope, entry);
            await this.refreshNow(scope);
            if (this.find(globalAddr)) { throw new Error(`Memory edit ${globalAddr} was not deleted`); }
        });
    }

    deleteAndRestoreAll(): Promise<void> {
        return this.mutate(async scope => {
            const entries = [...this.entries];
            try {
                for (const entry of entries) { await this.restoreAndDelete(scope, entry); }
            } finally {
                await this.refreshNow(scope);
            }
            if (this.entries.length) { throw new Error('Not all memory edits were restored and deleted'); }
        });
    }

    restoreRetaining(globalAddr: number): Promise<MemoryEditSnapshot> {
        return this.mutate(async scope => {
            const entry = this.requireEntry(globalAddr);
            const response = await scope.send<unknown>(
                IpcCommand.DEBUG_MEMORY_EDIT_RESTORE, { globalAddr }, 5000, 'high',
            );
            const result = decodeProtocolData(IpcCommand.DEBUG_MEMORY_EDIT_RESTORE, response, 'Unable to restore memory edit', decodeMemoryEditRestore);
            if (result.globalAddr !== globalAddr || result.restoredValue !== entry.originalValue || result.deleted !== true) {
                throw new Error('Memory edit restore returned an invalid result');
            }
            try {
                await this.sendMutation(scope,
                    IpcCommand.DEBUG_MEMORY_EDIT_ADD,
                    this.validate(scope, inputFrom(entry, { active: false })),
                );
            } finally {
                await this.refreshNow(scope);
            }
            const restored = this.requireEntry(globalAddr);
            if (restored.active) { throw new Error('Restored memory edit is still active'); }
            return restored;
        });
    }

    dispose(): void {
        this.operations.dispose();
        this.removeAllListeners();
    }

    private update(
        globalAddr: number,
        change: (entry: MemoryEditSnapshot) => MemoryEditInput,
    ): Promise<MemoryEditSnapshot> {
        return this.mutate(async scope => {
            const request = this.validate(scope, change(this.requireEntry(globalAddr)));
            await this.sendMutation(scope, IpcCommand.DEBUG_MEMORY_EDIT_ADD, request);
            await this.refreshNow(scope);
            return this.requireMatching(request);
        });
    }

    private async refreshNow(scope: SessionOperation): Promise<readonly MemoryEditSnapshot[]> {
        this.requireAvailable(scope);
        scope.assertCurrent();
        const response = await scope.send<unknown>(
            IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL, undefined, 5000, 'normal',
        );
        const entries = decodeProtocolData(IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL, response, 'Unable to list memory edits', data => decodeMemoryEditList(data, this.limits(scope)));
        scope.assertCurrent();
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
        requireProtocolOk(command, response, `Memory edit command ${command} failed`);
    }

    private async restoreAndDelete(scope: SessionOperation, entry: MemoryEditSnapshot): Promise<void> {
        const response = await scope.send<unknown>(
            IpcCommand.DEBUG_MEMORY_EDIT_RESTORE, { globalAddr: entry.globalAddr }, 5000, 'high',
        );
        const result = decodeProtocolData(IpcCommand.DEBUG_MEMORY_EDIT_RESTORE, response, 'Unable to restore memory edit', decodeMemoryEditRestore);
        if (result.globalAddr !== entry.globalAddr || result.restoredValue !== entry.originalValue || result.deleted !== true) {
            throw new Error('Memory edit restore returned an invalid result');
        }
    }

    private find(globalAddr: number): MemoryEditSnapshot | undefined {
        return this.entries.find(entry => entry.globalAddr === globalAddr);
    }

    private requireEntry(globalAddr: number): MemoryEditSnapshot {
        const entry = this.find(globalAddr);
        if (!entry) { throw new Error(`Memory edit ${globalAddr} no longer exists`); }
        return entry;
    }

    private requireMatching(input: MemoryEditInput): MemoryEditSnapshot {
        const entry = this.requireEntry(input.globalAddr);
        if (entry.enteredValue !== input.enteredValue || entry.readonly !== input.readonly
            || entry.active !== input.active || entry.comment !== input.comment) {
            throw new Error(`Memory edit ${input.globalAddr} does not match the acknowledged input`);
        }
        return entry;
    }

    private validate(scope: SessionOperation, input: unknown): MemoryEditInput {
        return validateMemoryEditInput(input, this.limits(scope));
    }

    private limits(scope: SessionOperation): MemoryEditValidationLimits {
        const limits = this.requireAvailable(scope).capabilities.memoryEditLimits!;
        return limits;
    }

    private requireAvailable(scope?: SessionOperation): GetServerInfoResponse {
        scope?.assertCurrent();
        const info = scope?.info ?? this.operations.capture().info;
        if (!this.lifecycle.connected || !info) { throw new Error('No active emulator session'); }
        validateMemoryEditServer(info);
        return info;
    }

    private reset(): void {
        this.entries = [];
        this.emit('change', this.entries);
    }
}

function inputFrom(entry: MemoryEditSnapshot, changes: Partial<MemoryEditInput>): MemoryEditInput {
    return {
        globalAddr: entry.globalAddr,
        enteredValue: entry.enteredValue,
        readonly: entry.readonly,
        active: entry.active,
        comment: entry.comment,
        ...changes,
    };
}