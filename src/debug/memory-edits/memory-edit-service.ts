import { EventEmitter } from 'events';
import { IpcClient } from '../../emulator/client/ipc-client';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import {
    MemoryEditInput,
    MemoryEditRestoreResponse,
    MemoryEditSnapshot,
} from '../../emulator/protocol/debug-models';
import { GetServerInfoResponse, IpcCommand, IpcResponse } from '../../emulator/protocol/ipc-commands';
import { validateMemoryEditServer } from '../../emulator/protocol/ipc-server-info';
import {
    decodeMemoryEditList,
    MemoryEditValidationLimits,
    validateMemoryEditInput,
} from './memory-edit-codec';

export class MemoryEditService extends EventEmitter {
    private entries: readonly MemoryEditSnapshot[] = [];
    private queue: Promise<void> = Promise.resolve();
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

    get snapshot(): readonly MemoryEditSnapshot[] { return this.entries; }
    get sessionGeneration(): number { return this.generation; }

    get available(): boolean {
        try {
            if (!this.lifecycle.connected || !this.lifecycle.serverInfo) { return false; }
            validateMemoryEditServer(this.lifecycle.serverInfo);
            return true;
        } catch { return false; }
    }

    refresh(): Promise<readonly MemoryEditSnapshot[]> {
        return this.enqueue(() => this.refreshNow());
    }

    apply(globalAddr: number, enteredValue: number, currentValue?: number): Promise<MemoryEditSnapshot | undefined> {
        return this.mutate(async () => {
            const existing = this.find(globalAddr);
            const request = this.validate({
                globalAddr,
                enteredValue,
                readonly: existing?.readonly ?? false,
                active: true,
                comment: existing?.comment ?? '',
            });
            if (!existing && request.enteredValue === currentValue) { return undefined; }
            await this.sendMutation(IpcCommand.DEBUG_MEMORY_EDIT_ADD, request);
            await this.refreshNow();
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
        return this.mutate(async () => {
            for (const entry of this.entries.filter(item => item.active)) {
                await this.sendMutation(
                    IpcCommand.DEBUG_MEMORY_EDIT_ADD,
                    this.validate(inputFrom(entry, { active: false })),
                );
            }
            await this.refreshNow();
            if (this.entries.some(entry => entry.active)) { throw new Error('Not all memory edits were disabled'); }
        });
    }

    delete(globalAddr: number): Promise<void> {
        return this.mutate(async () => {
            this.requireEntry(globalAddr);
            await this.sendMutation(IpcCommand.DEBUG_MEMORY_EDIT_DEL, { globalAddr });
            await this.refreshNow();
            if (this.find(globalAddr)) { throw new Error(`Memory edit ${globalAddr} was not deleted`); }
        });
    }

    deleteAll(): Promise<void> {
        return this.mutate(async () => {
            await this.sendMutation(IpcCommand.DEBUG_MEMORY_EDIT_DEL_ALL);
            await this.refreshNow();
            if (this.entries.length) { throw new Error('Not all memory edits were deleted'); }
        });
    }

    deleteAndRestore(globalAddr: number): Promise<void> {
        return this.mutate(async () => {
            const entry = this.requireEntry(globalAddr);
            await this.restoreAndDelete(entry);
            await this.refreshNow();
            if (this.find(globalAddr)) { throw new Error(`Memory edit ${globalAddr} was not deleted`); }
        });
    }

    deleteAndRestoreAll(): Promise<void> {
        return this.mutate(async () => {
            const entries = [...this.entries];
            try {
                for (const entry of entries) { await this.restoreAndDelete(entry); }
            } finally {
                await this.refreshNow();
            }
            if (this.entries.length) { throw new Error('Not all memory edits were restored and deleted'); }
        });
    }

    restoreRetaining(globalAddr: number): Promise<MemoryEditSnapshot> {
        return this.mutate(async () => {
            const entry = this.requireEntry(globalAddr);
            const response = await this.client.send<MemoryEditRestoreResponse>(
                IpcCommand.DEBUG_MEMORY_EDIT_RESTORE, { globalAddr }, 5000, 'high',
            );
            const result = this.responseData(response, 'Unable to restore memory edit');
            if (result.globalAddr !== globalAddr || result.restoredValue !== entry.originalValue || result.deleted !== true) {
                throw new Error('Memory edit restore returned an invalid result');
            }
            try {
                await this.sendMutation(
                    IpcCommand.DEBUG_MEMORY_EDIT_ADD,
                    this.validate(inputFrom(entry, { active: false })),
                );
            } finally {
                await this.refreshNow();
            }
            const restored = this.requireEntry(globalAddr);
            if (restored.active) { throw new Error('Restored memory edit is still active'); }
            return restored;
        });
    }

    dispose(): void {
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.removeAllListeners();
    }

    private update(
        globalAddr: number,
        change: (entry: MemoryEditSnapshot) => MemoryEditInput,
    ): Promise<MemoryEditSnapshot> {
        return this.mutate(async () => {
            const request = this.validate(change(this.requireEntry(globalAddr)));
            await this.sendMutation(IpcCommand.DEBUG_MEMORY_EDIT_ADD, request);
            await this.refreshNow();
            return this.requireMatching(request);
        });
    }

    private async refreshNow(): Promise<readonly MemoryEditSnapshot[]> {
        this.requireAvailable();
        const generation = this.generation;
        const response = await this.client.send<unknown>(
            IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL, undefined, 5000, 'normal',
        );
        const entries = decodeMemoryEditList(this.responseData(response, 'Unable to list memory edits'), this.limits());
        if (generation !== this.generation) { throw new Error('Memory edit response belongs to an inactive connection'); }
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
        if (!response.ok) { throw new Error(protocolError(response, `Memory edit command ${command} failed`)); }
    }

    private async restoreAndDelete(entry: MemoryEditSnapshot): Promise<void> {
        const response = await this.client.send<MemoryEditRestoreResponse>(
            IpcCommand.DEBUG_MEMORY_EDIT_RESTORE, { globalAddr: entry.globalAddr }, 5000, 'high',
        );
        const result = this.responseData(response, 'Unable to restore memory edit');
        if (result.globalAddr !== entry.globalAddr || result.restoredValue !== entry.originalValue || result.deleted !== true) {
            throw new Error('Memory edit restore returned an invalid result');
        }
    }

    private responseData<T>(response: IpcResponse<T>, fallback: string): T {
        if (!response.ok || response.data === undefined) { throw new Error(protocolError(response, fallback)); }
        return response.data;
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

    private validate(input: unknown): MemoryEditInput {
        return validateMemoryEditInput(input, this.limits());
    }

    private limits(): MemoryEditValidationLimits {
        const limits = this.requireAvailable().capabilities.memoryEditLimits!;
        return limits;
    }

    private requireAvailable(): GetServerInfoResponse {
        const info = this.lifecycle.serverInfo;
        if (!this.lifecycle.connected || !info) { throw new Error('No active emulator session'); }
        validateMemoryEditServer(info);
        return info;
    }

    private reset(): void {
        this.generation++;
        this.entries = [];
        this.emit('change', this.entries);
    }
}

function protocolError(response: IpcResponse, fallback: string): string {
    const field = typeof response.details?.field === 'string' ? ` (${response.details.field})` : '';
    return `${response.error ?? fallback}${field}`;
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