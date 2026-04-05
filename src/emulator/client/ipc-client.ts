import * as net from 'net';
import { IpcCommand, IpcResponse } from '../protocol/ipc-commands';
import { encodeRequest, decodeResponse, frameLength } from '../protocol/ipc-codec';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';
import { Logger } from '../../platform/logging/logger';

const DEFAULT_TIMEOUT_MS = 5000;
const CONNECT_TIMEOUT_MS = 3000;

export class IpcClient {
    private socket: net.Socket | null = null;
    private receiveBuffer = Buffer.alloc(0);
    private pendingResolve: ((buf: Buffer) => void) | null = null;
    private pendingReject: ((err: Error) => void) | null = null;
    private readonly logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    get connected(): boolean {
        return this.socket !== null && !this.socket.destroyed;
    }

    connect(port: number, host = '127.0.0.1'): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (this.socket) {
                resolve();
                return;
            }

            const socket = new net.Socket();
            const timer = setTimeout(() => {
                socket.destroy();
                reject(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, `Connection to ${host}:${port} timed out`));
            }, CONNECT_TIMEOUT_MS);

            socket.once('connect', () => {
                clearTimeout(timer);
                this.socket = socket;
                this.receiveBuffer = Buffer.alloc(0);
                this.setupListeners();
                this.logger.debug(`ipc-client: connected to ${host}:${port}`);
                resolve();
            });

            socket.once('error', (err) => {
                clearTimeout(timer);
                reject(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, `Connection to ${host}:${port} failed: ${err.message}`, err));
            });

            socket.connect(port, host);
        });
    }

    disconnect(): void {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.destroy();
            this.socket = null;
        }
        this.rejectPending(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'Disconnected'));
        this.receiveBuffer = Buffer.alloc(0);
    }

    async send<T = unknown>(cmd: IpcCommand, data?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<IpcResponse<T>> {
        if (!this.socket || this.socket.destroyed) {
            throw new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'Not connected');
        }

        const frame = encodeRequest(cmd, data);
        const rawResponse = await this.writeAndRead(frame, timeoutMs);
        return decodeResponse(rawResponse) as IpcResponse<T>;
    }

    async sendRaw(cmd: IpcCommand, data?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Buffer> {
        if (!this.socket || this.socket.destroyed) {
            throw new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'Not connected');
        }

        const frame = encodeRequest(cmd, data);
        return this.writeAndRead(frame, timeoutMs);
    }

    private writeAndRead(frame: Buffer, timeoutMs: number): Promise<Buffer> {
        return new Promise<Buffer>((resolve, reject) => {
            if (this.pendingResolve) {
                reject(new V6Error(ErrorCode.IPC_TIMEOUT, 'Another request is already pending'));
                return;
            }

            this.pendingResolve = resolve;
            this.pendingReject = reject;

            const timer = setTimeout(() => {
                this.rejectPending(new V6Error(ErrorCode.IPC_TIMEOUT, `IPC request timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            const origResolve = this.pendingResolve;
            this.pendingResolve = (buf: Buffer) => {
                clearTimeout(timer);
                origResolve(buf);
            };
            const origReject = this.pendingReject;
            this.pendingReject = (err: Error) => {
                clearTimeout(timer);
                origReject(err);
            };

            this.socket!.write(frame, (err) => {
                if (err) {
                    this.rejectPending(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, `Write failed: ${err.message}`, err));
                }
            });
        });
    }

    private setupListeners(): void {
        if (!this.socket) { return; }

        this.socket.on('data', (chunk: Buffer) => {
            this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
            this.tryDeliver();
        });

        this.socket.on('close', () => {
            this.logger.debug('ipc-client: connection closed');
            this.rejectPending(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, 'Connection closed by server'));
            this.socket = null;
        });

        this.socket.on('error', (err) => {
            this.logger.error(`ipc-client: socket error: ${err.message}`);
            this.rejectPending(new V6Error(ErrorCode.IPC_CONNECTION_REFUSED, `Socket error: ${err.message}`, err));
        });
    }

    private tryDeliver(): void {
        if (!this.pendingResolve) { return; }

        const len = frameLength(this.receiveBuffer);
        if (len === 0) { return; }

        const frame = Buffer.from(this.receiveBuffer.subarray(0, len));
        this.receiveBuffer = Buffer.from(this.receiveBuffer.subarray(len));

        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingReject = null;
        resolve(frame);
    }

    private rejectPending(err: Error): void {
        if (this.pendingReject) {
            const reject = this.pendingReject;
            this.pendingResolve = null;
            this.pendingReject = null;
            reject(err);
        }
    }
}
