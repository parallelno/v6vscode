import * as assert from 'assert';
import * as net from 'net';
import { once } from 'events';
import { encode } from '@msgpack/msgpack';
import { IpcClient } from '../../../src/emulator/client/ipc-client';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import { Logger } from '../../../src/platform/logging/logger';
import { V6Error } from '../../../src/platform/errors/v6-error';
import { ErrorCode } from '../../../src/platform/errors/error-codes';
import { TimerClock } from '../../../src/platform/async/timer-clock';

function response(data: unknown): Buffer {
    const payload = Buffer.from(encode({ ok: true, data }));
    const frame = Buffer.alloc(payload.length + 4);
    frame.writeUInt32LE(payload.length);
    payload.copy(frame, 4);
    return frame;
}

const logger = { debug() {}, error() {} } as unknown as Logger;

class ManualClock implements TimerClock {
    private now = 0;
    private sequence = 0;
    readonly tasks = new Map<ReturnType<typeof setTimeout>, { at: number; callback: () => void }>();
    schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
        const timer = ++this.sequence as unknown as ReturnType<typeof setTimeout>;
        this.tasks.set(timer, { at: this.now + delayMs, callback });
        return timer;
    }
    cancel(timer: ReturnType<typeof setTimeout> | undefined): void { if (timer !== undefined) { this.tasks.delete(timer); } }
    advance(delayMs: number): void {
        this.now += delayMs;
        for (const [timer, task] of [...this.tasks]) {
            if (task.at <= this.now && this.tasks.delete(timer)) { task.callback(); }
        }
    }
}
describe('IPC ordered-stream safety', () => {
    let server: net.Server;
    let client: IpcClient;
    let connections: net.Socket[];
    let port: number;

    beforeEach(async () => {
        connections = [];
        server = net.createServer(socket => { connections.push(socket); socket.on('error', () => {}); });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        port = (server.address() as net.AddressInfo).port;
        client = new IpcClient(logger);
    });

    afterEach(async () => {
        client.disconnect();
        for (const socket of connections) { socket.destroy(); }
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    async function connect(): Promise<net.Socket> {
        const accepted = once(server, 'connection');
        await client.connect(port);
        return (await accepted)[0] as net.Socket;
    }

    for (const failure of ['timeout', 'close', 'disconnect'] as const) {
        it(`rejects active and all queued requests on ${failure}, without writing the queued commands`, async () => {
            const socket = await connect();
            const received = once(socket, 'data');
            const first = client.send(IpcCommand.PING, {}, failure === 'timeout' ? 30 : 1000);
            const queued = client.send(IpcCommand.STOP, {}, 1000);
            const third = client.sendRaw(IpcCommand.GET_FRAME_RAW, {}, 1000, 'low');
            const results = Promise.allSettled([first, queued, third]);
            const [written] = await received;
            assert.strictEqual((written as Buffer).readUInt32LE(0) + 4, (written as Buffer).length);
            let laterWrites = 0;
            socket.on('data', () => laterWrites++);
            if (failure === 'close') { socket.destroy(); }
            if (failure === 'disconnect') { client.disconnect(); }
            const settled = await results;
            assert.ok(settled.every(result => result.status === 'rejected'));
            assert.strictEqual(client.connected, false);
            assert.strictEqual(laterWrites, 0);
            await assert.rejects(() => client.send(IpcCommand.RUN), /Not connected/);
        });
    }

    it('cannot assign a late response to a queued request and reconnects on a fresh stream', async () => {
        const socket = await connect();
        const received = once(socket, 'data');
        const results = Promise.allSettled([
            client.send(IpcCommand.PING, {}, 30), client.send(IpcCommand.STOP, {}, 1000),
        ]);
        await received;
        const settled = await results;
        assert.ok(settled.every(result => result.status === 'rejected'));
        socket.write(response({ request: 'late first' }));
        const fresh = await connect();
        const nextReceived = once(fresh, 'data');
        const next = client.send<{ fresh: boolean }>(IpcCommand.PING);
        await nextReceived;
        fresh.write(response({ fresh: true }));
        assert.deepStrictEqual((await next).data, { fresh: true });
    });

    it('coalesces concurrent connection attempts and allows cancellation before connection completes', async () => {
        const first = client.connect(port);
        const second = client.connect(port);
        assert.strictEqual(first, second);
        await Promise.all([first, second]);
        assert.strictEqual(connections.length, 1);
        client.disconnect();
        const pending = client.connect(port);
        const rejected = assert.rejects(pending, /Disconnected/);
        client.disconnect();
        await rejected;
        assert.strictEqual(client.connected, false);
    });

    it('assembles fragmented prefixes and payloads without advancing the queue early', async () => {
        const socket = await connect();
        const received = once(socket, 'data');
        const result = client.send<{ value: number }>(IpcCommand.PING);
        await received;
        const frame = response({ value: 42 });
        for (const part of [frame.subarray(0, 2), frame.subarray(2, 5), frame.subarray(5)]) {
            socket.write(part);
            await new Promise<void>(resolve => setImmediate(resolve));
        }
        assert.deepStrictEqual((await result).data, { value: 42 });
    });

    it('rejects coalesced unsolicited responses rather than retaining one for the next request', async () => {
        const socket = await connect();
        const received = once(socket, 'data');
        const settled = Promise.allSettled([client.send(IpcCommand.PING), client.send(IpcCommand.STOP)]);
        await received;
        socket.write(Buffer.concat([response({ first: true }), response({ unsolicited: true })]));
        assert.ok((await settled).every(result => result.status === 'rejected'));
        assert.strictEqual(client.connected, false);
    });

    it('invalidates the stream on malformed MessagePack before dispatching the next request', async () => {
        const socket = await connect();
        const received = once(socket, 'data');
        const settled = Promise.allSettled([client.send(IpcCommand.PING), client.send(IpcCommand.STOP)]);
        await received;
        socket.write(Buffer.from([1, 0, 0, 0, 0xC1]));
        assert.ok((await settled).every(result => result.status === 'rejected'));
        assert.strictEqual(client.connected, false);
    });

    it('rejects a truncated response when the server closes', async () => {
        const socket = await connect();
        const received = once(socket, 'data');
        const result = client.send(IpcCommand.PING);
        const rejected = assert.rejects(result, /closed|ended/i);
        await received;
        socket.end(response({ value: 42 }).subarray(0, 5));
        await rejected;
        assert.strictEqual(client.connected, false);
    });

    it('rejects oversized frame declarations before buffering the payload', async () => {
        const socket = await connect();
        const received = once(socket, 'data');
        const rejected = assert.rejects(client.send(IpcCommand.PING), (error: unknown) =>
            error instanceof V6Error && error.code === ErrorCode.IPC_DECODE_ERROR);
        await received;
        socket.write(Buffer.from([255, 255, 255, 127]));
        await rejected;
        assert.strictEqual(client.connected, false);
    });

    it('expires an unsent queue entry without corrupting the active stream', async () => {
        const socket = await connect();
        const received = once(socket, 'data');
        const first = client.send<{ first: boolean }>(IpcCommand.PING, {}, 1000);
        const expired = assert.rejects(client.send(IpcCommand.STOP, {}, 20), /queue wait timed out/);
        await received;
        await expired;
        assert.strictEqual(client.connected, true);
        socket.write(response({ first: true }));
        assert.deepStrictEqual((await first).data, { first: true });
        const nextReceived = once(socket, 'data');
        const next = client.send(IpcCommand.RUN);
        await nextReceived;
        socket.write(response({ running: true }));
        assert.strictEqual((await next).ok, true);
    });

    it('bounds queued request count without dropping work already accepted', async () => {
        client = new IpcClient(logger, { maxQueuedRequests: 1 });
        const socket = await connect();
        const received = once(socket, 'data');
        const first = client.send(IpcCommand.PING);
        const second = client.send(IpcCommand.STOP);
        await assert.rejects(client.send(IpcCommand.RUN), /capacity exceeded/);
        await received;
        const nextReceived = once(socket, 'data');
        socket.write(response({ first: true }));
        await first;
        await nextReceived;
        socket.write(response({ second: true }));
        assert.strictEqual((await second).ok, true);
    });

    it('bounds queued bytes and outgoing payload size', async () => {
        client = new IpcClient(logger, { maxQueuedBytes: 1, maxPayloadBytes: 128 });
        const socket = await connect();
        const received = once(socket, 'data');
        const first = client.send(IpcCommand.PING);
        await assert.rejects(client.send(IpcCommand.STOP), /capacity exceeded/);
        await assert.rejects(client.send(IpcCommand.RUN, { text: 'x'.repeat(256) }), /payload limit/);
        await received;
        socket.write(response({ first: true }));
        assert.strictEqual((await first).ok, true);
        assert.strictEqual(client.connected, true);
    });

    it('accepts a frame exactly at the configured limit', async () => {
        const frame = response({ text: 'x'.repeat(100) });
        client = new IpcClient(logger, { maxPayloadBytes: frame.length - 4 });
        const socket = await connect();
        const received = once(socket, 'data');
        const result = client.send(IpcCommand.PING);
        await received;
        socket.write(frame);
        assert.strictEqual((await result).ok, true);
    });

    it('can reconnect after a refused connection and does not retain a rejected connect promise', async () => {
        const unused = net.createServer();
        unused.listen(0, '127.0.0.1');
        await once(unused, 'listening');
        const refusedPort = (unused.address() as net.AddressInfo).port;
        await new Promise<void>(resolve => unused.close(() => resolve()));
        await assert.rejects(client.connect(refusedPort), /failed|closed/);
        const socket = await connect();
        const received = once(socket, 'data');
        const result = client.send(IpcCommand.PING);
        await received;
        socket.write(response({ recovered: true }));
        assert.strictEqual((await result).ok, true);
    });

    it('settles active and queued work if a socket write fails asynchronously', async () => {
        await connect();
        const sockets = client as unknown as { socket: net.Socket };
        const socket = sockets.socket;
        const original = socket.write.bind(socket);
        let writes = 0;
        socket.write = ((...args: unknown[]) => {
            writes++;
            const callback = args[args.length - 1] as (error?: Error) => void;
            setImmediate(() => callback(new Error('synthetic write failure')));
            return true;
        }) as typeof socket.write;
        try {
            const settled = await Promise.allSettled([client.send(IpcCommand.PING), client.send(IpcCommand.STOP)]);
            assert.ok(settled.every(result => result.status === 'rejected'));
            assert.strictEqual(writes, 1);
            assert.strictEqual(client.connected, false);
        } finally { socket.write = original; }
    });

    it('settles work when socket.write throws synchronously', async () => {
        await connect();
        const socket = (client as unknown as { socket: net.Socket }).socket;
        socket.write = (() => { throw new Error('synthetic synchronous failure'); }) as typeof socket.write;
        await assert.rejects(client.send(IpcCommand.PING), /write failed/);
        assert.strictEqual(client.connected, false);
    });
    it('rechecks a queued operation scope at dispatch and leaves unrelated requests usable', async () => {
        const socket = await connect();
        const received = once(socket, 'data');
        let current = true;
        const scope = { key: {}, assertCurrent() { if (!current) { throw new Error('stale operation'); } } };
        const first = client.send(IpcCommand.PING);
        const stale = assert.rejects(client.send(IpcCommand.STOP, {}, 1000, 'high', scope), /stale operation/);
        const next = client.send(IpcCommand.RUN);
        await received;
        current = false;
        const nextReceived = once(socket, 'data');
        socket.write(response({ first: true }));
        await first;
        await stale;
        await nextReceived;
        socket.write(response({ next: true }));
        assert.strictEqual((await next).ok, true);
        assert.strictEqual(client.connected, true);
    });

    it('discards a stale active result but consumes its frame before dispatching the next command', async () => {
        const socket = await connect();
        const received = once(socket, 'data');
        let current = true;
        const scope = { key: {}, assertCurrent() { if (!current) { throw new Error('stale operation'); } } };
        const stale = assert.rejects(client.send(IpcCommand.PING, {}, 1000, 'normal', scope), /stale operation/);
        const next = client.send(IpcCommand.RUN);
        await received;
        current = false;
        const nextReceived = once(socket, 'data');
        socket.write(response({ old: true }));
        await stale;
        await nextReceived;
        socket.write(response({ next: true }));
        assert.deepStrictEqual((await next).data, { next: true });
        assert.strictEqual(client.connected, true);
    });

    it('changes the connection epoch on disconnect and reconnect', async () => {
        await connect();
        const first = client.connectionEpoch;
        client.disconnect();
        assert.ok(client.connectionEpoch > first);
        const disconnected = client.connectionEpoch;
        await connect();
        assert.ok(client.connectionEpoch > disconnected);
    });
    it('uses injected deadlines to separate queue expiry from on-wire timeout deterministically', async () => {
        const clock = new ManualClock();
        client = new IpcClient(logger, {}, clock);
        const socket = await connect();
        assert.strictEqual(clock.tasks.size, 0, 'connect deadline was cancelled');
        const received = once(socket, 'data');
        const first = client.send(IpcCommand.PING, {}, 100);
        const queueExpired = assert.rejects(client.send(IpcCommand.STOP, {}, 20), /queue wait timed out/);
        await received;
        clock.advance(20);
        await queueExpired;
        assert.strictEqual(client.connected, true);
        socket.write(response({ first: true }));
        await first;
        assert.strictEqual(clock.tasks.size, 0);
        const activeReceived = once(socket, 'data');
        const timedOut = assert.rejects(client.send(IpcCommand.RUN, {}, 100), /request timed out/);
        const queued = assert.rejects(client.send(IpcCommand.STOP, {}, 1000), /request timed out/);
        await activeReceived;
        clock.advance(99);
        assert.strictEqual(client.connected, true);
        clock.advance(1);
        await Promise.all([timedOut, queued]);
        assert.strictEqual(client.connected, false);
        assert.strictEqual(clock.tasks.size, 0);
    });
});
