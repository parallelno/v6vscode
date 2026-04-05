import * as net from 'net';
import { encode, decode } from '@msgpack/msgpack';

/**
 * Minimal TCP server that speaks the v6emul length-prefixed MessagePack protocol.
 * Used for IPC integration tests.
 */
export class MockTcpServer {
    private server: net.Server | null = null;
    private connections: net.Socket[] = [];
    private _port = 0;
    private handler: (cmd: number, data: unknown) => unknown;

    constructor(handler?: (cmd: number, data: unknown) => unknown) {
        this.handler = handler ?? defaultHandler;
    }

    get port(): number {
        return this._port;
    }

    start(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => {
                this.connections.push(socket);
                let receiveBuffer = Buffer.alloc(0);

                socket.on('data', (chunk: Buffer) => {
                    receiveBuffer = Buffer.concat([receiveBuffer, chunk]);

                    while (receiveBuffer.length >= 4) {
                        const payloadLen = receiveBuffer.readUInt32LE(0);
                        const totalLen = 4 + payloadLen;

                        if (receiveBuffer.length < totalLen) {
                            break;
                        }

                        const payloadBuf = receiveBuffer.subarray(4, totalLen);
                        receiveBuffer = Buffer.from(receiveBuffer.subarray(totalLen));

                        try {
                            const request = decode(payloadBuf) as { cmd: number; data: unknown };
                            const response = this.handler(request.cmd, request.data);
                            const responseBuf = encode(response);
                            const frame = Buffer.alloc(4 + responseBuf.byteLength);
                            frame.writeUInt32LE(responseBuf.byteLength, 0);
                            Buffer.from(responseBuf.buffer, responseBuf.byteOffset, responseBuf.byteLength).copy(frame, 4);
                            socket.write(frame);
                        } catch {
                            const errResp = encode({ ok: false, error: 'handler error' });
                            const frame = Buffer.alloc(4 + errResp.byteLength);
                            frame.writeUInt32LE(errResp.byteLength, 0);
                            Buffer.from(errResp.buffer, errResp.byteOffset, errResp.byteLength).copy(frame, 4);
                            socket.write(frame);
                        }
                    }
                });

                socket.on('error', () => {});
            });

            this.server.listen(0, '127.0.0.1', () => {
                const addr = this.server!.address() as net.AddressInfo;
                this._port = addr.port;
                resolve(this._port);
            });

            this.server.on('error', reject);
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve) => {
            for (const conn of this.connections) {
                conn.destroy();
            }
            this.connections = [];
            if (this.server) {
                this.server.close(() => resolve());
                this.server = null;
            } else {
                resolve();
            }
        });
    }
}

function defaultHandler(cmd: number, _data: unknown): unknown {
    switch (cmd) {
        case -1: // PING
            return { ok: true, data: { pong: true } };
        case 1: // RUN
        case 2: // STOP
        case 5: // RESET
        case 6: // RESTART
        case 42: // SET_CPU_SPEED
            return { ok: true };
        case 3: // IS_RUNNING
            return { ok: true, data: { isRunning: false } };
        case 4: // EXIT
            return { ok: true, data: { exiting: true } };
        default:
            return { ok: true, data: {} };
    }
}
