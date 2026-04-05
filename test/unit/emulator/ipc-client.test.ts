import { expect } from 'chai';
import { MockTcpServer } from '../../../test/helpers/mock-tcp-server';
import { IpcClient } from '../../../src/emulator/client/ipc-client';
import { IpcCommand, PingResponse, IsRunningResponse, ExitResponse } from '../../../src/emulator/protocol/ipc-commands';
import { ErrorCode } from '../../../src/platform/errors/error-codes';
import { V6Error } from '../../../src/platform/errors/v6-error';

function makeLogger() {
    return {
        error: () => {},
        warn: () => {},
        info: () => {},
        debug: () => {},
        dispose: () => {},
    } as any;
}

describe('IpcClient + MockTcpServer', () => {
    let server: MockTcpServer;
    let client: IpcClient;

    beforeEach(async () => {
        server = new MockTcpServer();
        await server.start();
        client = new IpcClient(makeLogger());
    });

    afterEach(async () => {
        client.disconnect();
        await server.stop();
    });

    it('should connect and send PING', async () => {
        await client.connect(server.port);
        const resp = await client.send<PingResponse>(IpcCommand.PING);
        expect(resp.ok).to.equal(true);
        expect(resp.data!.pong).to.equal(true);
    });

    it('should send IS_RUNNING', async () => {
        await client.connect(server.port);
        const resp = await client.send<IsRunningResponse>(IpcCommand.IS_RUNNING);
        expect(resp.ok).to.equal(true);
        expect(resp.data!.isRunning).to.equal(false);
    });

    it('should send EXIT', async () => {
        await client.connect(server.port);
        const resp = await client.send<ExitResponse>(IpcCommand.EXIT);
        expect(resp.ok).to.equal(true);
        expect(resp.data!.exiting).to.equal(true);
    });

    it('should send RUN and STOP', async () => {
        await client.connect(server.port);
        let resp = await client.send(IpcCommand.RUN);
        expect(resp.ok).to.equal(true);
        resp = await client.send(IpcCommand.STOP);
        expect(resp.ok).to.equal(true);
    });

    it('should send SET_CPU_SPEED with data', async () => {
        await client.connect(server.port);
        const resp = await client.send(IpcCommand.SET_CPU_SPEED, { speed: 3 });
        expect(resp.ok).to.equal(true);
    });

    it('should handle custom server handler', async () => {
        await server.stop();

        server = new MockTcpServer((cmd, data) => {
            if (cmd === -1) {
                return { ok: true, data: { pong: true, custom: 'yes' } };
            }
            return { ok: true };
        });
        await server.start();

        await client.connect(server.port);
        const resp = await client.send<PingResponse & { custom: string }>(IpcCommand.PING);
        expect(resp.ok).to.equal(true);
        expect((resp.data as any).custom).to.equal('yes');
    });

    it('should throw when connecting to a non-existent server', async () => {
        const badClient = new IpcClient(makeLogger());
        try {
            await badClient.connect(1); // Port 1 should refuse connection
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).to.be.instanceOf(V6Error);
            expect((err as V6Error).code).to.be.oneOf([
                ErrorCode.IPC_CONNECTION_REFUSED,
            ]);
        }
    });

    it('should throw when sending without connection', async () => {
        try {
            await client.send(IpcCommand.PING);
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).to.be.instanceOf(V6Error);
            expect((err as V6Error).code).to.equal(ErrorCode.IPC_CONNECTION_REFUSED);
        }
    });

    it('should report connected state correctly', async () => {
        expect(client.connected).to.equal(false);
        await client.connect(server.port);
        expect(client.connected).to.equal(true);
        client.disconnect();
        expect(client.connected).to.equal(false);
    });

    it('should handle multiple sequential requests', async () => {
        await client.connect(server.port);
        for (let i = 0; i < 5; i++) {
            const resp = await client.send<PingResponse>(IpcCommand.PING);
            expect(resp.ok).to.equal(true);
        }
    });
});
