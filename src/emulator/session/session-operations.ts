import type { GetServerInfoResponse, IpcCommand, IpcResponse } from '../protocol/ipc-commands';
import { OperationScope, ScopedTaskQueue, SingleFlight } from '../../platform/async/scoped-task-queue';

/** Narrow observation port; no process launcher, panel, or VS Code dependency. */
export interface SessionState {
    readonly connected: boolean;
    readonly running: boolean;
    readonly serverInfo: GetServerInfoResponse | undefined;
    on(event: 'stateChange', listener: () => void): unknown;
    removeListener(event: 'stateChange', listener: () => void): unknown;
}

export interface CommandSender {
    send<T = unknown>(command: IpcCommand, data?: unknown, timeout?: number,
        priority?: 'critical' | 'high' | 'normal' | 'low', scope?: OperationScope): Promise<IpcResponse<T>>;
}

/** Implementations must check a supplied scope again when queued work reaches the wire. */
export interface CommandTransport extends CommandSender {
    readonly connectionEpoch: number;
    readonly connected: boolean;
}

export class InactiveSessionError extends Error {
    readonly name = 'InactiveSessionError';
    constructor() { super('Operation belongs to an inactive connection or disposed service'); }
}

export interface SessionOperation extends OperationScope, CommandSender {
    readonly info: GetServerInfoResponse;
}

/** Captures identity before queueing; guards every wire exchange and publication. */
export class SessionOperations<TRefresh> {
    private readonly queue = new ScopedTaskQueue();
    private readonly refreshes = new SingleFlight<TRefresh>();
    private key: object = {};
    private revision = 0;
    private disposed = false;
    private observedInfo: GetServerInfoResponse | undefined;
    private observedEpoch: number;
    private readonly listener: () => void;

    constructor(private readonly state: SessionState, private readonly transport: CommandTransport,
        private readonly onInvalidate: () => void) {
        this.observedInfo = state.serverInfo;
        this.observedEpoch = transport.connectionEpoch;
        this.listener = () => {
            if (!state.connected || this.observedInfo !== state.serverInfo || this.observedEpoch !== transport.connectionEpoch) { this.invalidate(); }
        };
        state.on('stateChange', this.listener);
    }

    get generation(): number { this.synchronize(); return this.revision; }

    capture(): SessionOperation {
        this.synchronize();
        const key = this.key;
        const info = this.state.serverInfo;
        const epoch = this.transport.connectionEpoch;
        if (this.disposed || !this.state.connected || !info || this.transport.connected === false) { throw new InactiveSessionError(); }
        const assertCurrent = () => {
            this.synchronize();
            if (this.disposed || key !== this.key || !this.state.connected || this.state.serverInfo !== info
                || this.transport.connected === false || this.transport.connectionEpoch !== epoch) { throw new InactiveSessionError(); }
        };
        const operation: SessionOperation = {
            key, info, assertCurrent,
            send: async <T>(command: IpcCommand, data?: unknown, timeout?: number, priority?: 'critical' | 'high' | 'normal' | 'low') => {
                assertCurrent();
                const response = await this.transport.send<T>(command, data, timeout, priority, operation);
                assertCurrent();
                return response;
            },
        };
        return operation;
    }

    enqueue<T>(operation: (scope: SessionOperation) => Promise<T>): Promise<T> {
        try {
            const scope = this.capture();
            return this.queue.run(scope, () => operation(scope));
        } catch (error) { return Promise.reject(error); }
    }

    refresh(operation: (scope: SessionOperation) => Promise<TRefresh>): Promise<TRefresh> {
        try {
            const scope = this.capture();
            return this.refreshes.run(scope.key, () => this.queue.run(scope, () => operation(scope)));
        } catch (error) { return Promise.reject(error); }
    }

    dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;
        this.state.removeListener('stateChange', this.listener);
        this.invalidate();
    }

    private synchronize(): void {
        if (!this.disposed && (this.observedEpoch !== this.transport.connectionEpoch || this.observedInfo !== this.state.serverInfo)) {
            this.invalidate();
        }
    }

    private invalidate(): void {
        this.key = {};
        this.revision++;
        this.observedInfo = this.state.serverInfo;
        this.observedEpoch = this.transport.connectionEpoch;
        this.onInvalidate();
    }
}
