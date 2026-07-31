import { expect } from 'chai';
import * as net from 'net';
import { V6emulLocator, V6emulLocatorDeps } from '../../src/emulator/launcher/v6emul-locator';
import { IpcClient } from '../../src/emulator/client/ipc-client';
import { IpcCommand } from '../../src/emulator/protocol/ipc-commands';
import { MockTcpServer } from '../helpers/mock-tcp-server';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { V6Error } from '../../src/platform/errors/v6-error';
import { encodeRequest, decodeResponse } from '../../src/emulator/protocol/ipc-codec';

function makeLogger() {
    return { error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, dispose: () => {} } as any;
}

describe('Emulator regression tests', () => {
    describe('Missing v6emul binary at launch time', () => {
        it('should throw EMULATOR_NOT_FOUND when no resolution succeeds', () => {
            const deps: V6emulLocatorDeps = {
                logger: makeLogger(),
                getConfiguration: () => ({ get: () => '' }),
                getEnv: () => undefined,
                which: () => undefined,
            };
            const locator = new V6emulLocator(deps);
            expect(() => locator.resolve()).to.throw(V6Error).with.property('code', ErrorCode.EMULATOR_NOT_FOUND);
        });

        it('should throw EMULATOR_NOT_FOUND when setting path is invalid', () => {
            const deps: V6emulLocatorDeps = {
                logger: makeLogger(),
                getConfiguration: () => ({ get: () => '/totally/invalid/path/v6emul' }),
                getEnv: () => undefined,
                which: () => undefined,
            };
            const locator = new V6emulLocator(deps);
            expect(() => locator.resolve()).to.throw(V6Error).with.property('code', ErrorCode.EMULATOR_NOT_FOUND);
        });
    });

    describe('TCP connection refused', () => {
        it('should throw IPC_CONNECTION_REFUSED when connecting to closed port', async () => {
            const client = new IpcClient(makeLogger());
            try {
                await client.connect(1); // Port 1 — connection should be refused
                expect.fail('should have thrown');
            } catch (err) {
                expect(err).to.be.instanceOf(V6Error);
                expect((err as V6Error).code).to.equal(ErrorCode.IPC_CONNECTION_REFUSED);
            }
        });
    });

    describe('IPC timeout', () => {
        let server: net.Server;
        let port: number;
        const connections: net.Socket[] = [];

        beforeEach((done) => {
            connections.length = 0;
            // Server that accepts connections but never responds
            server = net.createServer((socket) => {
                connections.push(socket);
                // intentionally do nothing — simulate timeout
            });
            server.listen(0, '127.0.0.1', () => {
                port = (server.address() as net.AddressInfo).port;
                done();
            });
        });

        afterEach((done) => {
            for (const conn of connections) {
                conn.destroy();
            }
            server.close(() => done());
        });

        it('should throw IPC_TIMEOUT when server does not respond', async () => {
            const client = new IpcClient(makeLogger());
            await client.connect(port);
            try {
                await client.send(IpcCommand.PING, undefined, 200); // 200ms timeout
                expect.fail('should have thrown');
            } catch (err) {
                expect(err).to.be.instanceOf(V6Error);
                expect((err as V6Error).code).to.equal(ErrorCode.IPC_TIMEOUT);
            } finally {
                client.disconnect();
            }
        });
    });

    describe('Unexpected disconnect', () => {
        let mockServer: MockTcpServer;

        beforeEach(async () => {
            mockServer = new MockTcpServer();
            await mockServer.start();
        });

        afterEach(async () => {
            await mockServer.stop();
        });

        it('should throw when server disconnects mid-session', async () => {
            const client = new IpcClient(makeLogger());
            await client.connect(mockServer.port);

            // Verify connection works
            const resp = await client.send(IpcCommand.PING);
            expect(resp.ok).to.equal(true);

            // Kill the server
            await mockServer.stop();

            // Next request should fail
            try {
                await client.send(IpcCommand.PING, undefined, 500);
                expect.fail('should have thrown');
            } catch (err) {
                expect(err).to.be.instanceOf(V6Error);
            } finally {
                client.disconnect();
            }
        });
    });

    describe('Codec edge cases', () => {
        it('should handle zero-payload response', () => {
            const { encode } = require('@msgpack/msgpack');
            const payload = encode({ ok: true });
            const buf = Buffer.alloc(4 + payload.byteLength);
            buf.writeUInt32LE(payload.byteLength, 0);
            Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(buf, 4);
            const decoded = decodeResponse(buf);
            expect(decoded.ok).to.equal(true);
        });

        it('should round-trip encode/decode for complex data', () => {
            const req = encodeRequest(IpcCommand.LOAD_ROM, {
                data: [0x00, 0x01, 0x02, 0xff],
                addr: 0x100,
                autorun: true,
            });
            // The encoded request can be decoded as a MessagePack object
            const decoded = decodeResponse(req);
            expect(decoded).to.have.property('cmd');
        });
    });
});
