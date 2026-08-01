import { EventEmitter } from 'events';
import { IpcClient } from '../../emulator/client/ipc-client';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import {
    WatchpointAddRequest,
    WatchpointEditRequest,
    WatchpointEntry,
} from '../../emulator/protocol/debug-models';
import { GetServerInfoResponse, IpcCommand, IpcResponse } from '../../emulator/protocol/ipc-commands';
import { validateWatchpointServer } from '../../emulator/protocol/ipc-server-info';
import {
    decodeWatchpointList,
    DEFAULT_WATCHPOINT_LIMITS,
    validateWatchpointConfig,
    WatchpointValidationLimits,
} from './watchpoint-validator';

interface WatchpointUpdatesResponse { updates: number; }

export class WatchpointService extends EventEmitter {
    private entries: readonly WatchpointEntry[] = [];
    private updateCounter: number | undefined;
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

    get snapshot(): readonly WatchpointEntry[] { return this.entries; }
    get sessionGeneration(): number { return this.generation; }

    get available(): boolean {
        try {
            if (!this.lifecycle.connected || !this.lifecycle.serverInfo) { return false; }
            validateWatchpointServer(this.lifecycle.serverInfo);
            return true;
        } catch { return false; }
    }

    async refresh(): Promise<readonly WatchpointEntry[]> {
        this.requireAvailable();
        const generation = this.generation;
        const response = await this.client.send<unknown>(IpcCommand.DEBUG_WATCHPOINT_GET_ALL, undefined, 5000, 'high');
        const data = this.responseData(response, 'Unable to list watchpoints');
        const entries = decodeWatchpointList(data, this.limits());
        if (generation !== this.generation) { throw new Error('Watchpoint response belongs to an inactive session'); }
        this.entries = Object.freeze(entries.map(entry => Object.freeze(entry)));
        this.emit('change', this.entries);
        await this.readUpdateCounter(generation);
        return this.entries;
    }

    async refreshIfChanged(): Promise<boolean> {
        this.requireAvailable();
        const generation = this.generation;
        const current = await this.fetchUpdateCounter();
        if (generation !== this.generation) { return false; }
        if (this.updateCounter === undefined || current !== this.updateCounter) {
            await this.refresh();
            return true;
        }
        return false;
    }

    add(candidate: WatchpointAddRequest): Promise<WatchpointEntry> {
        return this.mutate(async () => {
            const request = validateWatchpointConfig(candidate, this.limits());
            const oldIds = new Set(this.entries.map(entry => entry.id));
            await this.sendMutation(IpcCommand.DEBUG_WATCHPOINT_ADD, request);
            await this.refresh();
            const matches = this.entries.filter(entry => !oldIds.has(entry.id) && sameConfig(entry, request));
            if (matches.length !== 1) { throw new Error('Unable to identify the added watchpoint'); }
            return matches[0];
        });
    }

    edit(candidate: WatchpointEditRequest): Promise<WatchpointEntry> {
        return this.mutate(async () => {
            if (!Number.isSafeInteger(candidate.id) || candidate.id < 0) { throw new Error('Invalid watchpoint id'); }
            const { id, ...config } = candidate;
            const request = { id, ...validateWatchpointConfig(config, this.limits()) };
            await this.sendMutation(IpcCommand.DEBUG_WATCHPOINT_EDIT, request);
            await this.refresh();
            const updated = this.entries.find(entry => entry.id === request.id);
            if (!updated || !sameConfig(updated, request)) { throw new Error(`Watchpoint ${request.id} was not updated`); }
            return updated;
        });
    }

    delete(id: number): Promise<void> {
        return this.mutate(async () => {
            if (!Number.isSafeInteger(id) || id < 0) { throw new Error('Invalid watchpoint id'); }
            await this.sendMutation(IpcCommand.DEBUG_WATCHPOINT_DEL, { id });
            await this.refresh();
            if (this.entries.some(entry => entry.id === id)) { throw new Error(`Watchpoint ${id} was not deleted`); }
        });
    }

    deleteAll(): Promise<void> {
        return this.mutate(async () => {
            await this.sendMutation(IpcCommand.DEBUG_WATCHPOINT_DEL_ALL);
            await this.refresh();
            if (this.entries.length) { throw new Error('Not all watchpoints were deleted'); }
        });
    }

    disableAll(): Promise<void> {
        return this.mutate(async () => {
            for (const entry of this.entries.filter(item => item.active)) {
                await this.sendMutation(IpcCommand.DEBUG_WATCHPOINT_EDIT, { ...entry, active: false });
            }
            await this.refresh();
            if (this.entries.some(entry => entry.active)) { throw new Error('Not all watchpoints were disabled'); }
        });
    }

    dispose(): void {
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.removeAllListeners();
    }

    private mutate<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.queue.then(() => {
            const info = this.requireAvailable();
            if (this.lifecycle.running && info.capabilities.watchpointMutationsWhileRunning !== true) {
                throw new Error('The active emulator does not allow watchpoint changes while running');
            }
            return operation();
        });
        this.queue = result.then(() => undefined, () => undefined);
        return result;
    }

    private async sendMutation(command: IpcCommand, data?: unknown): Promise<void> {
        const response = await this.client.send(command, data, 5000, 'high');
        if (!response.ok) { throw new Error(protocolError(response, `Watchpoint command ${command} failed`)); }
    }

    private async fetchUpdateCounter(): Promise<number> {
        const response = await this.client.send<WatchpointUpdatesResponse>(
            IpcCommand.DEBUG_WATCHPOINT_GET_UPDATES, undefined, 5000, 'normal',
        );
        const data = this.responseData(response, 'Unable to read watchpoint updates');
        if (!data || !Number.isInteger(data.updates) || data.updates < 0 || data.updates > 0xFFFFFFFF) {
            throw new Error('Invalid watchpoint update counter');
        }
        return data.updates;
    }

    private async readUpdateCounter(generation: number): Promise<void> {
        const counter = await this.fetchUpdateCounter();
        if (generation === this.generation) { this.updateCounter = counter; }
    }

    private responseData<T>(response: IpcResponse<T>, fallback: string): T {
        if (!response.ok || response.data === undefined) { throw new Error(protocolError(response, fallback)); }
        return response.data;
    }

    private limits(): WatchpointValidationLimits {
        const advertised = this.lifecycle.serverInfo?.capabilities.watchpointLimits;
        return {
            ...DEFAULT_WATCHPOINT_LIMITS,
            maxRangeLength: advertised?.maxRangeLength ?? DEFAULT_WATCHPOINT_LIMITS.maxRangeLength,
            maxCommentBytes: advertised?.maxCommentBytes ?? DEFAULT_WATCHPOINT_LIMITS.maxCommentBytes,
        };
    }

    private requireAvailable(): GetServerInfoResponse {
        const info = this.lifecycle.serverInfo;
        if (!this.lifecycle.connected || !info) { throw new Error('No active emulator session'); }
        validateWatchpointServer(info);
        return info;
    }

    private reset(): void {
        this.generation++;
        this.entries = [];
        this.updateCounter = undefined;
        this.emit('change', this.entries);
    }
}

function sameConfig(left: WatchpointAddRequest, right: WatchpointAddRequest): boolean {
    return left.globalAddr === right.globalAddr && left.len === right.len && left.value === right.value
        && left.access === right.access && left.condition === right.condition && left.type === right.type
        && left.active === right.active && left.comment === right.comment;
}

function protocolError(response: IpcResponse, fallback: string): string {
    const field = typeof response.details?.field === 'string' ? ` (${response.details.field})` : '';
    return `${response.error ?? fallback}${field}`;
}