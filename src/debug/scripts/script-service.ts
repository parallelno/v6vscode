import { EventEmitter } from 'events';
import { IpcClient } from '../../emulator/client/ipc-client';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import {
    ScriptInput,
    ScriptLimits,
    ScriptRunOnceResponse,
    ScriptSnapshot,
} from '../../emulator/protocol/debug-models';
import { GetServerInfoResponse, IpcCommand, IpcResponse } from '../../emulator/protocol/ipc-commands';
import { validateScriptServer } from '../../emulator/protocol/ipc-server-info';
import {
    decodeScriptCollectionResponse,
    decodeScriptMutationResponse,
    decodeScriptRunOnceResponse,
    decodeScriptUpdates,
    validateScriptInput,
} from './script-codec';

export class ScriptService extends EventEmitter {
    private entries: readonly ScriptSnapshot[] = Object.freeze([]);
    private revision: number | undefined;
    private queue: Promise<void> = Promise.resolve();
    private refreshInFlight: Promise<readonly ScriptSnapshot[]> | undefined;
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

    get snapshot(): readonly ScriptSnapshot[] { return this.entries; }
    get sessionGeneration(): number { return this.generation; }
    get collectionRevision(): number | undefined { return this.revision; }

    get available(): boolean {
        try { this.requireAvailable(); return true; } catch { return false; }
    }

    refresh(): Promise<readonly ScriptSnapshot[]> {
        if (this.refreshInFlight) { return this.refreshInFlight; }
        const refresh = this.enqueue(() => this.refreshNow());
        this.refreshInFlight = refresh;
        void refresh.finally(() => {
            if (this.refreshInFlight === refresh) { this.refreshInFlight = undefined; }
        }).catch(() => undefined);
        return refresh;
    }

    refreshIfChanged(): Promise<boolean> {
        return this.enqueue(async () => {
            this.requireAvailable();
            const generation = this.generation;
            const response = await this.client.send<unknown>(
                IpcCommand.DEBUG_SCRIPT_GET_UPDATES, {}, 5000, 'normal',
            );
            const current = decodeScriptUpdates(this.responseData(response, 'Unable to read script updates'));
            if (generation !== this.generation) { return false; }
            if (this.revision === undefined || current !== this.revision) {
                await this.refreshNow();
                return true;
            }
            return false;
        });
    }

    add(input: ScriptInput): Promise<ScriptSnapshot> {
        return this.mutate(false, async () => {
            const request = this.validate(input);
            const response = await this.client.send<unknown>(IpcCommand.DEBUG_SCRIPT_ADD, request, 5000, 'high');
            const result = decodeScriptMutationResponse(
                this.responseData(response, 'Unable to add script'), this.limits(),
            );
            if (!matches(result.script, request)) { throw new Error('Added script does not match the acknowledged input'); }
            this.applyMutation(result.script, result.updates);
            return result.script;
        });
    }

    edit(scriptId: number, input: ScriptInput): Promise<ScriptSnapshot> {
        return this.mutate(false, async () => {
            const previous = this.requireEntry(scriptId);
            const request = this.validate(input);
            const response = await this.client.send<unknown>(
                IpcCommand.DEBUG_SCRIPT_EDIT, { scriptId, ...request }, 5000, 'high',
            );
            const result = decodeScriptMutationResponse(
                this.responseData(response, 'Unable to edit script'), this.limits(),
            );
            if (result.script.scriptId !== scriptId || !matches(result.script, request)) {
                throw new Error(`Edited script ${scriptId} does not match the acknowledged input`);
            }
            this.applyMutation(result.script, result.updates);
            if (previous.active && !result.script.active) { this.emit('overlayRemove', scriptId); }
            return result.script;
        });
    }

    setActivity(scriptId: number, active: boolean): Promise<ScriptSnapshot> {
        const entry = this.requireEntry(scriptId);
        return this.edit(scriptId, inputFrom(entry, { active }));
    }

    disable(scriptId: number): Promise<ScriptSnapshot> {
        return this.mutate(false, async () => {
            this.requireEntry(scriptId);
            const response = await this.client.send<unknown>(
                IpcCommand.DEBUG_SCRIPT_DISABLE, { scriptId }, 5000, 'high',
            );
            const result = decodeScriptMutationResponse(
                this.responseData(response, 'Unable to disable script'), this.limits(),
            );
            if (result.script.scriptId !== scriptId || result.script.active) {
                throw new Error(`Script ${scriptId} was not disabled`);
            }
            this.applyMutation(result.script, result.updates);
            this.emit('overlayRemove', scriptId);
            return result.script;
        });
    }

    compile(scriptId: number): Promise<ScriptSnapshot> {
        return this.mutate(false, async () => {
            this.requireEntry(scriptId);
            const response = await this.client.send<unknown>(
                IpcCommand.DEBUG_SCRIPT_COMPILE, { scriptId }, 5000, 'high',
            );
            const result = decodeScriptMutationResponse(
                this.responseData(response, 'Unable to compile script'), this.limits(),
            );
            if (result.script.scriptId !== scriptId) { throw new Error('Compiled script identity changed'); }
            this.applyMutation(result.script, result.updates);
            return result.script;
        });
    }

    runOnce(scriptId: number): Promise<ScriptRunOnceResponse> {
        return this.mutate(true, async () => {
            const entry = this.requireEntry(scriptId);
            if (entry.compilation.status !== 'compiled') { throw new Error(`Script ${scriptId} is not compiled`); }
            const response = await this.client.send<unknown>(
                IpcCommand.DEBUG_SCRIPT_RUN_ONCE, { scriptId }, 5000, 'high',
            );
            const result = decodeScriptRunOnceResponse(
                this.responseData(response, 'Unable to run script'), this.limits(),
            );
            if (result.scriptId !== scriptId) { throw new Error('Run Once script identity changed'); }
            this.applyMutation({ ...entry, runtime: result.runtime }, result.updates);
            return result;
        });
    }

    disableAll(): Promise<number> {
        return this.mutate(false, async () => {
            const activeScriptIds = this.entries.filter(entry => entry.active).map(entry => entry.scriptId);
            const response = await this.client.send<unknown>(
                IpcCommand.DEBUG_SCRIPT_DISABLE_ALL, {}, 5000, 'high',
            );
            const data = objectData(this.responseData(response, 'Unable to disable all scripts'));
            const disabled = integer(data.disabled, 'disabled', 0, this.entries.length);
            await this.refreshNow();
            for (const scriptId of activeScriptIds) { this.emit('overlayRemove', scriptId); }
            return disabled;
        });
    }

    delete(scriptId: number): Promise<void> {
        return this.mutate(false, async () => {
            this.requireEntry(scriptId);
            await this.sendMutation(IpcCommand.DEBUG_SCRIPT_DEL, { scriptId });
            await this.refreshNow();
            if (this.find(scriptId)) { throw new Error(`Script ${scriptId} was not deleted`); }
            this.emit('overlayRemove', scriptId);
        });
    }

    deleteAll(): Promise<void> {
        return this.mutate(false, async () => {
            await this.sendMutation(IpcCommand.DEBUG_SCRIPT_DEL_ALL, {});
            await this.refreshNow();
            if (this.entries.length) { throw new Error('Not all scripts were deleted'); }
            this.emit('overlayClear');
        });
    }

    dispose(): void {
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.removeAllListeners();
    }

    private async refreshNow(): Promise<readonly ScriptSnapshot[]> {
        const limits = this.limits();
        const generation = this.generation;
        const response = await this.client.send<unknown>(
            IpcCommand.DEBUG_SCRIPT_GET_ALL, {}, 5000, 'normal',
        );
        const result = decodeScriptCollectionResponse(
            this.responseData(response, 'Unable to list scripts'), limits,
        );
        if (generation !== this.generation) { throw new Error('Script response belongs to an inactive connection'); }
        this.publish(result.scripts, result.updates);
        return this.entries;
    }

    private mutate<T>(runOnce: boolean, operation: () => Promise<T>): Promise<T> {
        return this.enqueue(async () => {
            const info = this.requireAvailable();
            const allowed = runOnce
                ? info.capabilities.scriptRunOnceWhileRunning
                : info.capabilities.scriptMutationsWhileRunning;
            if (this.lifecycle.running && allowed !== true) {
                throw new Error(`The active emulator does not allow script ${runOnce ? 'execution' : 'changes'} while running`);
            }
            try { return await operation(); } catch (error) {
                try { await this.refreshNow(); } catch { /* Preserve the operation failure. */ }
                throw error;
            }
        });
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.queue.then(operation);
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }

    private applyMutation(script: ScriptSnapshot, revision: number): void {
        const entries = this.entries.filter(entry => entry.scriptId !== script.scriptId);
        entries.push(script);
        entries.sort((left, right) => left.scriptId - right.scriptId);
        this.publish(entries, revision);
    }

    private publish(entries: readonly ScriptSnapshot[], revision: number): void {
        this.entries = Object.freeze(entries.map(entry => Object.freeze({
            ...entry,
            compilation: Object.freeze({ ...entry.compilation }),
            runtime: Object.freeze({ ...entry.runtime }),
        })));
        this.revision = revision;
        this.emit('change', this.entries);
    }

    private async sendMutation(command: IpcCommand, data: unknown): Promise<void> {
        const response = await this.client.send(command, data, 5000, 'high');
        if (!response.ok) { throw new Error(protocolError(response, `Script command ${command} failed`)); }
    }

    private responseData<T>(response: IpcResponse<T>, fallback: string): T {
        if (!response.ok || response.data === undefined) { throw new Error(protocolError(response, fallback)); }
        return response.data;
    }

    private validate(input: unknown): ScriptInput {
        return validateScriptInput(input, this.limits());
    }

    private limits(): ScriptLimits {
        return this.requireAvailable().capabilities.scriptLimits!;
    }

    private requireAvailable(): GetServerInfoResponse {
        const info = this.lifecycle.serverInfo;
        if (!this.lifecycle.connected || !info) { throw new Error('No active emulator session'); }
        validateScriptServer(info);
        return info;
    }

    private find(scriptId: number): ScriptSnapshot | undefined {
        return this.entries.find(entry => entry.scriptId === scriptId);
    }

    private requireEntry(scriptId: number): ScriptSnapshot {
        if (!Number.isSafeInteger(scriptId) || scriptId < 0 || scriptId > 0x7FFFFFFF) {
            throw new Error('Invalid scriptId');
        }
        const entry = this.find(scriptId);
        if (!entry) { throw new Error(`Script ${scriptId} no longer exists`); }
        return entry;
    }

    private reset(): void {
        this.generation++;
        this.entries = Object.freeze([]);
        this.revision = undefined;
        this.emit('sessionReset');
        this.emit('change', this.entries);
    }
}

function inputFrom(entry: ScriptSnapshot, changes: Partial<ScriptInput>): ScriptInput {
    return { name: entry.name, path: entry.path, active: entry.active, ...changes };
}

function matches(entry: ScriptSnapshot, input: ScriptInput): boolean {
    return entry.name === input.name && entry.path === input.path && entry.active === input.active;
}

function protocolError(response: IpcResponse, fallback: string): string {
    const field = typeof response.details?.field === 'string' ? ` (${response.details.field})` : '';
    const reason = typeof response.details?.reason === 'string' ? `: ${response.details.reason}` : '';
    return `${response.error ?? fallback}${field}${reason}`;
}

function objectData(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error('Script response must be an object');
    }
    return value as Record<string, unknown>;
}

function integer(value: unknown, field: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
        throw new Error(`${field} must be an integer in ${min}..${max}`);
    }
    return value as number;
}
