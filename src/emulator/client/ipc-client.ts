import { TimerClock, systemTimerClock } from '../../platform/async/timer-clock';
import type { OperationScope } from '../../platform/async/scoped-task-queue';
import * as net from 'net';
import { EventEmitter } from 'events';
import { IpcCommand, IpcResponse } from '../protocol/ipc-commands';
import { encodeRequest, decodeResponse, frameLength, MAX_IPC_PAYLOAD_BYTES } from '../protocol/ipc-codec';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';
import { Logger } from '../../platform/logging/logger';

const DEFAULT_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 3000;

export type IpcPriority = 'critical' | 'high' | 'normal' | 'low';
const PRIORITY_ORDER: Record<IpcPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };

export interface IpcClientLimits {
    maxQueuedRequests: number;
    maxQueuedBytes: number;
    maxPayloadBytes: number;
}

const DEFAULT_LIMITS: IpcClientLimits = {
    maxQueuedRequests: 256,
    maxQueuedBytes: 32 * 1024 * 1024,
    maxPayloadBytes: MAX_IPC_PAYLOAD_BYTES,
};

interface PendingRequest {
    frame: Buffer;
    timeoutMs: number;
    priority: IpcPriority;
    sequence: number;
    complete(frame: Buffer): void;
    reject(error: Error): void;
    timer?: ReturnType<typeof setTimeout>;
    scope?: OperationScope;
}

/** One request at a time: an indeterminate stream must be abandoned, not reused. */
export class IpcClient extends EventEmitter {
    private socket: net.Socket | null = null;
    private connecting: { promise: Promise<void>; cancel(error: Error): void } | undefined;
    private receiveBuffer = Buffer.alloc(0);
    private active: PendingRequest | undefined;
    private readonly requestQueue: PendingRequest[] = [];
    private queuedBytes = 0;
    private nextSequence = 0;
    private epoch = 0;
    private readonly limits: IpcClientLimits;

    constructor(private readonly logger: Logger, limits: Partial<IpcClientLimits> = {}, private readonly clock: TimerClock = systemTimerClock) {
        super();
        this.limits = { ...DEFAULT_LIMITS, ...limits };
        for (const value of Object.values(this.limits)) {
            if (!Number.isSafeInteger(value) || value <= 0) { throw new RangeError('IPC limits must be positive safe integers'); }
        }
    }

    get connectionEpoch(): number { return this.epoch; }

    get connected(): boolean { return this.socket !== null && !this.socket.destroyed; }

    connect(port: number, host = '127.0.0.1'): Promise<void> {
        if (this.connected) { return Promise.resolve(); }
        if (this.connecting) { return this.connecting.promise; }
        const socket = new net.Socket();
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
        const cleanup = () => {
            this.clock.cancel(timer);
            socket.removeAllListeners();
            // A cancelled connect/write can still report an asynchronous error.
            socket.on('error', () => {});
            this.connecting = undefined;
        };
        const cancel = (error: Error) => {
            cleanup();
            socket.destroy();
            reject(error);
        };
        const timer = this.clock.schedule(() => cancel(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED,
            `Connection to ${host}:${port} timed out`)), CONNECT_TIMEOUT_MS);
        this.connecting = { promise, cancel };
        socket.once('connect', () => {
            cleanup();
            this.epoch++;
            this.socket = socket;
            this.receiveBuffer = Buffer.alloc(0);
            this.setupListeners(socket);
            this.logger.debug(`ipc-client: connected to ${host}:${port}`);
            resolve();
        });
        socket.once('error', error => cancel(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED,
            `Connection to ${host}:${port} failed: ${error.message}`, error)));
        socket.once('close', () => cancel(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'Connection closed before connecting')));
        try { socket.connect(port, host); } catch (error) {
            cancel(error instanceof Error ? error : new Error(String(error)));
        }
        return promise;
    }

    disconnect(): void {
        this.failConnection(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'Disconnected'));
    }

    send<T = unknown>(cmd: IpcCommand, data?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS, priority: IpcPriority = 'normal', scope?: OperationScope): Promise<IpcResponse<T>> {
        return this.request(cmd, data, timeoutMs, priority, frame => decodeResponse(frame) as IpcResponse<T>, scope);
    }

    sendRaw(cmd: IpcCommand, data?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS, priority: IpcPriority = 'normal', scope?: OperationScope): Promise<Buffer> {
        return this.request(cmd, data, timeoutMs, priority, frame => frame, scope);
    }

    private request<T>(cmd: IpcCommand, data: unknown, timeoutMs: number, priority: IpcPriority, decode: (frame: Buffer) => T, scope?: OperationScope): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            scope?.assertCurrent();
            if (!this.connected) { throw new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'Not connected'); }
            if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 0x7FFFFFFF) { throw new RangeError('Invalid IPC timeout'); }
            const frame = encodeRequest(cmd, data);
            if (frame.length - 4 > this.limits.maxPayloadBytes) { throw new RangeError('IPC request exceeds payload limit'); }
            const request: PendingRequest = {
                frame, timeoutMs, priority, sequence: this.nextSequence++,
                scope, reject,
                complete: raw => {
                    const value = decode(raw); // A malformed wire response still fails the stream.
                    try { scope?.assertCurrent(); resolve(value); } catch (error) { reject(error); }
                },
            };
            if (!this.active) { this.executeWrite(request); return; }
            if (this.requestQueue.length >= this.limits.maxQueuedRequests || this.queuedBytes + frame.length > this.limits.maxQueuedBytes) {
                throw new V6Error(ErrorCode.IPC_TIMEOUT, 'IPC request queue capacity exceeded');
            }
            // Queue wait is bounded independently; expiring unsent work does not
            // invalidate the stream. The on-wire deadline starts at dispatch.
            request.timer = this.clock.schedule(() => {
                const index = this.requestQueue.indexOf(request);
                if (index < 0) { return; }
                this.requestQueue.splice(index, 1);
                this.queuedBytes -= frame.length;
                reject(new V6Error(ErrorCode.IPC_TIMEOUT, `IPC queue wait timed out after ${timeoutMs}ms`));
            }, timeoutMs);
            this.requestQueue.push(request);
            this.queuedBytes += frame.length;
            this.requestQueue.sort((left, right) => PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] || left.sequence - right.sequence);
        });
    }

    private executeWrite(request: PendingRequest): void {
        this.clock.cancel(request.timer);
        try { request.scope?.assertCurrent(); } catch (error) {
            request.reject(error instanceof Error ? error : new Error(String(error)));
            this.processNextInQueue();
            return;
        }
        const socket = this.socket;
        if (!socket || socket.destroyed) { request.reject(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'Not connected')); return; }
        this.active = request;
        request.timer = this.clock.schedule(() => {
            if (this.socket === socket && this.active === request) {
                this.failConnection(new V6Error(ErrorCode.IPC_TIMEOUT, `IPC request timed out after ${request.timeoutMs}ms`));
            }
        }, request.timeoutMs);
        try {
            socket.write(request.frame, error => {
                if (error && this.socket === socket) {
                    this.failConnection(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, `Write failed: ${error.message}`, error));
                }
            });
        } catch (error) {
            this.failConnection(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'IPC write failed', error instanceof Error ? error : undefined));
        }
    }

    private setupListeners(socket: net.Socket): void {
        socket.on('data', (chunk: Buffer) => {
            if (this.socket !== socket) { return; }
            try {
                if (!this.active) { throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Unsolicited IPC response'); }
                if (this.receiveBuffer.length + chunk.length > this.limits.maxPayloadBytes + 4) {
                    throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'IPC receive buffer exceeds payload limit');
                }
                this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
                const length = frameLength(this.receiveBuffer, this.limits.maxPayloadBytes);
                if (!length) { return; }
                // The server cannot reply to an unsent request. Extra bytes are
                // unsolicited, not a response to cache for the next command.
                if (length !== this.receiveBuffer.length) { throw new V6Error(ErrorCode.IPC_DECODE_ERROR, 'Unexpected extra IPC response bytes'); }
                const request = this.active;
                request.complete(this.receiveBuffer); // Validate before advancing the queue.
                this.clock.cancel(request.timer);
                this.active = undefined;
                this.receiveBuffer = Buffer.alloc(0);
                this.processNextInQueue();
            } catch (error) {
                this.failConnection(error instanceof Error ? error : new Error(String(error)));
            }
        });
        socket.on('end', () => {
            if (this.socket === socket) { this.failConnection(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'Connection ended by server')); }
        });
        socket.on('close', () => {
            if (this.socket === socket) { this.failConnection(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'Connection closed by server')); }
        });
        socket.on('error', error => {
            if (this.socket !== socket) { return; }
            this.logger.error(`ipc-client: socket error: ${error.message}`);
            this.failConnection(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, `Socket error: ${error.message}`, error));
        });
    }

    /** Detach first, settle everything once, and never dispatch on a failed stream. */
    private failConnection(error: Error): void {
        const wasConnected = this.socket !== null || this.connecting !== undefined;
        if (this.socket || this.connecting) { this.epoch++; }
        this.connecting?.cancel(error);
        const socket = this.socket;
        this.socket = null;
        this.receiveBuffer = Buffer.alloc(0);
        const pending = this.active;
        this.active = undefined;
        const queued = this.requestQueue.splice(0);
        this.queuedBytes = 0;
        socket?.removeAllListeners();
        socket?.on('error', () => {});
        socket?.destroy();
        for (const request of pending ? [pending, ...queued] : queued) {
            this.clock.cancel(request.timer);
            request.reject(error);
        }
        if (wasConnected) { this.emit('disconnect', error); }
    }

    private processNextInQueue(): void {
        if (!this.connected || this.active) { return; }
        const next = this.requestQueue.shift();
        if (next) { this.queuedBytes -= next.frame.length; this.executeWrite(next); }
    }
}
