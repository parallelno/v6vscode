import * as assert from 'assert';
import { EventEmitter } from 'events';
import { SessionCoordinator } from '../../../src/emulator/session/session-coordinator';
import { IpcCommand, IpcResponse } from '../../../src/emulator/protocol/ipc-commands';
import { OperationScope } from '../../../src/platform/async/scoped-task-queue';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const info = {
    protocolVersion: 2, emulatorVersion: 'test',
    commands: [IpcCommand.GET_FRAME_RAW, IpcCommand.GET_STACK_SAMPLE, IpcCommand.DEBUG_ATTACH,
        IpcCommand.DEBUG_BREAKPOINT_ADD, IpcCommand.DEBUG_BREAKPOINT_DEL,
        IpcCommand.DEBUG_BREAKPOINT_GET_ALL, IpcCommand.DEBUG_BREAKPOINT_GET_UPDATES],
    capabilities: { rawFrameSchema: 1, debugger: true, stackSampleSchema: 1, breakpointSchema: 1 },
};

class Transport extends EventEmitter {
    connected = false;
    connectionEpoch = 0;
    commands: IpcCommand[] = [];
    handler: ((command: IpcCommand) => Promise<IpcResponse<unknown>>) | undefined;
    async connect(_port: number, _host?: string) { this.connected = true; this.connectionEpoch++; }
    disconnect() { const was = this.connected; this.connected = false; this.connectionEpoch++; if (was) { this.emit('disconnect'); } }
    async send<T>(command: IpcCommand, _data?: unknown, _timeout?: number, _priority?: string, scope?: OperationScope): Promise<IpcResponse<T>> {
        scope?.assertCurrent();
        this.commands.push(command);
        const response = this.handler ? await this.handler(command)
            : command === IpcCommand.GET_SERVER_INFO ? { ok: true, data: info } : { ok: true };
        scope?.assertCurrent();
        return response as IpcResponse<T>;
    }
}

function fixture() {
    const client = new Transport();
    const processes: Array<{ exit: ReturnType<typeof deferred<number>>; kills: number }> = [];
    const coordinator = new SessionCoordinator({ resolve: () => 'emulator' } as any, {
        launch: () => {
            const process = { exit: deferred<number>(), kills: 0 };
            processes.push(process);
            return { spawnResult: { process: { kill: () => process.kills++ }, exitPromise: process.exit.promise } };
        },
    } as any, client as any, { info() {}, debug() {}, error() {} } as any, {} as any);
    return { coordinator, client, processes };
}

describe('Session coordinator ownership and identity', () => {
    it('publishes borrowed attach to lifecycle observers and never exits or persists it on shutdown', async () => {
        const { coordinator, client } = fixture();
        let persisted = 0;
        coordinator.registerStopParticipant(async () => { persisted++; });
        const lease = await coordinator.attach(9876);
        assert.deepStrictEqual(coordinator.connectionSnapshot, {
            connection: 'connected', execution: 'paused', ownership: 'borrowed', mode: 'attach', debuggerAttached: true,
        });
        assert.deepStrictEqual(client.commands, [IpcCommand.GET_SERVER_INFO, IpcCommand.PING, IpcCommand.DEBUG_ATTACH, IpcCommand.STOP]);
        coordinator.setExecutionRunning(true);
        assert.strictEqual(coordinator.running, true);
        await coordinator.shutdown();
        assert.strictEqual(persisted, 0);
        assert.ok(!client.commands.includes(IpcCommand.EXIT));
        assert.strictEqual(lease.connected, false);
        assert.strictEqual(coordinator.connectionSnapshot.ownership, 'none');
    });

    it('rejects a saved command lease after reconnect without sending to the replacement', async () => {
        const { coordinator, client } = fixture();
        const old = await coordinator.attach(9876);
        coordinator.disconnect();
        await coordinator.attach(9877);
        const count = client.commands.length;
        await assert.rejects(old.send(IpcCommand.RUN), /inactive connection/);
        assert.strictEqual(client.commands.length, count);
        coordinator.disconnect();
    });

    it('discards delayed negotiation and cleans it before opening the replacement', async () => {
        const { coordinator, client } = fixture();
        const entered = deferred<void>(), gate = deferred<IpcResponse<unknown>>();
        client.handler = async command => { assert.strictEqual(command, IpcCommand.GET_SERVER_INFO); entered.resolve(); return gate.promise; };
        const rejected = assert.rejects(coordinator.attach(9876), /inactive connection/);
        await entered.promise;
        const replacement = coordinator.attach(9877);
        gate.resolve({ ok: true, data: info });
        client.handler = undefined;
        await rejected;
        await replacement;
        assert.deepStrictEqual(client.commands, [IpcCommand.GET_SERVER_INFO, IpcCommand.GET_SERVER_INFO,
            IpcCommand.PING, IpcCommand.DEBUG_ATTACH, IpcCommand.STOP]);
        coordinator.disconnect();
    });

    it('clears failed attach negotiation without exiting the external emulator', async () => {
        const { coordinator, client } = fixture();
        client.handler = async () => ({ ok: false, error: 'unsupported' });
        await assert.rejects(coordinator.attach(9876), /unsupported/);
        assert.strictEqual(client.connected, false);
        assert.strictEqual(coordinator.serverInfo, undefined);
        assert.ok(!client.commands.includes(IpcCommand.EXIT));
        client.handler = undefined;
        await coordinator.attach(9876);
        coordinator.disconnect();
    });

    it('ignores a detached owned-process exit after a new process has connected', async () => {
        const { coordinator, client, processes } = fixture();
        await coordinator.startDebug({ program: 'first.rom', bootRomPath: 'boot.bin' });
        const old = coordinator.captureSession();
        coordinator.disconnect();
        await coordinator.startDebug({ program: 'second.rom', bootRomPath: 'boot.bin' });
        processes[0].exit.resolve(0);
        await Promise.resolve();
        assert.strictEqual(coordinator.owner, 'debug');
        assert.strictEqual(client.connected, true);
        assert.strictEqual(old.connected, false);
        coordinator.disconnect();
    });

    it('invalidates observers and leases on unexpected transport loss', async () => {
        const { coordinator, client } = fixture();
        const lease = await coordinator.attach(9876);
        client.disconnect();
        assert.strictEqual(coordinator.connected, false);
        assert.strictEqual(coordinator.serverInfo, undefined);
        assert.strictEqual(lease.connected, false);
        coordinator.disconnect();
    });

    it('does not replace an owned session with an attach request', async () => {
        const { coordinator, client } = fixture();
        await coordinator.startDebug({ program: 'owned.rom', bootRomPath: 'boot.bin' });
        await assert.rejects(coordinator.attach(9876), /Stop the owned emulator/);
        assert.strictEqual(coordinator.owner, 'debug');
        assert.strictEqual(client.connected, true);
        coordinator.disconnect();
    });

    it('rejects a launch superseded before execution and never allocates its process', async () => {
        const { coordinator, processes } = fixture();
        const rejected = assert.rejects(coordinator.startDebug({ program: 'old.rom', bootRomPath: 'boot.bin' }), /inactive connection/);
        const next = coordinator.startDebug({ program: 'new.rom', bootRomPath: 'boot.bin' });
        await rejected;
        await next;
        assert.strictEqual(processes.length, 1);
        coordinator.disconnect();
    });
});