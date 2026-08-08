import { EventEmitter } from 'events';
import { IpcClient } from '../../emulator/client/ipc-client';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import {
    GetServerInfoResponse,
    IpcCommand,
    IpcResponse,
    TraceLogEntry,
    TraceLogFilterRequest,
    TraceLogWindowResponse,
} from '../../emulator/protocol/ipc-commands';
import { validateTraceLogServer } from '../../emulator/protocol/ipc-server-info';
import { decodeTraceLogFilterResponse, decodeTraceLogWindowResponse } from './trace-log-codec';

export interface TraceLogFilterState {
    readonly filterId: number;
    readonly totalMatches: number;
    readonly generation: number;
}

export class TraceLogService extends EventEmitter {
    private visible = false;
    private generation = 0;
    private filterState: TraceLogFilterState | undefined;
    private readonly windows = new Map<number, TraceLogWindowResponse>();
    private readonly windowRequests = new Map<number, Promise<TraceLogWindowResponse>>();
    private readonly stateListener: () => void;

    constructor(
        private readonly lifecycle: EmulatorLifecycle,
        private readonly client: IpcClient,
    ) {
        super();
        this.stateListener = () => {
            if (!this.lifecycle.connected || this.lifecycle.running) { this.invalidate(); }
        };
        this.lifecycle.on('stateChange', this.stateListener);
    }

    get activeFilter(): TraceLogFilterState | undefined { return this.filterState; }
    get sessionGeneration(): number { return this.generation; }

    get available(): boolean {
        try {
            this.requirePaused();
            return true;
        } catch {
            return false;
        }
    }

    get limits(): { capacity: number; maxLines: number; maxPatternBytes: number } | undefined {
        try { return this.requirePaused().capabilities.traceLogLimits; }
        catch { return undefined; }
    }

    setVisible(visible: boolean): void {
        if (this.visible === visible) { return; }
        this.visible = visible;
        if (!visible) { this.invalidate(); }
    }

    async filter(request: TraceLogFilterRequest): Promise<TraceLogFilterState> {
        const info = this.requirePaused();
        validateRequest(request, info.capabilities.traceLogLimits!.maxPatternBytes);
        const requestGeneration = ++this.generation;
        this.filterState = undefined;
        this.windows.clear();
        this.windowRequests.clear();
        this.emit('change');

        const response = await this.client.send<unknown>(
            IpcCommand.DEBUG_TRACE_LOG_FILTER, request, 5000, 'normal',
        );
        this.requireCurrent(requestGeneration);
        const decoded = decodeTraceLogFilterResponse(
            responseData(response, 'Unable to filter the trace log'),
            info.capabilities.traceLogLimits!.capacity,
        );
        const state = Object.freeze({ ...decoded, generation: requestGeneration });
        this.filterState = state;
        this.emit('change');
        return state;
    }

    window(start: number, lines: number): Promise<TraceLogWindowResponse> {
        const info = this.requirePaused();
        const filter = this.filterState;
        if (!filter) { return Promise.reject(new Error('No active trace-log filter')); }
        if (!Number.isSafeInteger(start) || start < 0 || start > filter.totalMatches) {
            return Promise.reject(new Error('Trace-log window start is outside the filtered result'));
        }
        if (!Number.isSafeInteger(lines) || lines <= 0) {
            return Promise.reject(new Error('Trace-log window lines must be a positive integer'));
        }
        if (start === filter.totalMatches) {
            return Promise.resolve(Object.freeze({ start, entries: Object.freeze([]) }));
        }

        const blockSize = info.capabilities.traceLogLimits!.maxLines;
        const blockStart = Math.floor(start / blockSize) * blockSize;
        const cached = this.windows.get(blockStart);
        if (cached) { return Promise.resolve(cached); }
        const pending = this.windowRequests.get(blockStart);
        if (pending) { return pending; }

        const requestedLines = Math.min(blockSize, filter.totalMatches - blockStart);
        const requestGeneration = this.generation;
        const promise = this.loadWindow(filter, blockStart, requestedLines, requestGeneration);
        this.windowRequests.set(blockStart, promise);
        void promise.then(
            () => this.windowRequests.delete(blockStart),
            () => this.windowRequests.delete(blockStart),
        );
        return promise;
    }

    entry(index: number): TraceLogEntry | undefined {
        for (const window of this.windows.values()) {
            const offset = index - window.start;
            if (offset >= 0 && offset < window.entries.length) { return window.entries[offset]; }
        }
        return undefined;
    }

    invalidate(): void {
        this.generation++;
        this.filterState = undefined;
        this.windows.clear();
        this.windowRequests.clear();
        this.emit('change');
    }

    dispose(): void {
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.invalidate();
        this.removeAllListeners();
    }

    private async loadWindow(
        filter: TraceLogFilterState,
        start: number,
        lines: number,
        requestGeneration: number,
    ): Promise<TraceLogWindowResponse> {
        const response = await this.client.send<unknown>(
            IpcCommand.DEBUG_TRACE_LOG_WINDOW,
            { filterId: filter.filterId, start, lines },
            5000,
            'normal',
        );
        this.requireCurrent(requestGeneration, filter.filterId);
        const decoded = decodeTraceLogWindowResponse(
            responseData(response, 'Unable to read the trace log'), start, lines, filter.totalMatches,
        );
        this.windows.set(start, decoded);
        this.trimWindows(start);
        return decoded;
    }

    private trimWindows(currentStart: number): void {
        const retained = [...this.windows.keys()]
            .sort((left, right) => Math.abs(left - currentStart) - Math.abs(right - currentStart))
            .slice(0, 3);
        for (const start of this.windows.keys()) {
            if (!retained.includes(start)) { this.windows.delete(start); }
        }
    }

    private requireCurrent(generation: number, filterId?: number): void {
        if (generation !== this.generation
            || !this.visible
            || !this.lifecycle.connected
            || this.lifecycle.running
            || (filterId !== undefined && this.filterState?.filterId !== filterId)) {
            throw new Error('Trace-log response belongs to an inactive result');
        }
    }

    private requirePaused(): GetServerInfoResponse {
        const info = this.lifecycle.serverInfo;
        if (!this.visible) { throw new Error('Trace Log panel is not visible'); }
        if (!this.lifecycle.connected || !info) { throw new Error('No active emulator session'); }
        if (this.lifecycle.running) { throw new Error('Trace-log queries require a paused emulator'); }
        validateTraceLogServer(info);
        return info;
    }
}

function validateRequest(request: TraceLogFilterRequest, maxPatternBytes: number): void {
    for (const [field, value] of Object.entries(request)) {
        if (field !== 'addressPattern' && field !== 'instructionPattern') {
            throw new Error(`Unsupported trace-log filter field ${field}`);
        }
        if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxPatternBytes) {
            throw new Error(`${field} must be a UTF-8 string of at most ${maxPatternBytes} bytes`);
        }
    }
}

function responseData(response: IpcResponse<unknown>, fallback: string): unknown {
    if (!response.ok || response.data === undefined) {
        const field = typeof response.details?.field === 'string' ? ` (${response.details.field})` : '';
        throw new Error(`${response.error ?? fallback}${field}`);
    }
    return response.data;
}