import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EmulatorLifecycle } from '../../../src/emulator/lifecycle/emulator-lifecycle';
import { FddPersistence } from '../../../src/emulator/persistence/fdd-persistence';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }

describe('Awaited emulator stop participants', () => {
    let directory: string;
    beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-stop-')); });
    afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

    async function fixture(debug = false) {
        const calls: IpcCommand[] = [];
        let exited = deferred();
        let failExport = false;
        const client = {
            connected: true, connectionEpoch: 1,
            connect: async () => { client.connected = true; },
            disconnect: () => { client.connected = false; client.connectionEpoch++; },
            send: async (command: IpcCommand) => {
                calls.push(command);
                if (command === IpcCommand.GET_SERVER_INFO) { return { ok: true, data: {
                    protocolVersion: 2, emulatorVersion: 'test',
                    commands: [IpcCommand.GET_FRAME_RAW, IpcCommand.GET_STACK_SAMPLE, IpcCommand.DEBUG_ATTACH,
                        IpcCommand.DEBUG_BREAKPOINT_ADD, IpcCommand.DEBUG_BREAKPOINT_DEL,
                        IpcCommand.DEBUG_BREAKPOINT_GET_ALL, IpcCommand.DEBUG_BREAKPOINT_GET_UPDATES],
                    capabilities: { rawFrameSchema: 1, debugger: true, stackSampleSchema: 1, breakpointSchema: 1 },
                } }; }
                if (command === IpcCommand.GET_FDD_INFO) { return { ok: true, data: { mounted: true, updated: true } }; }
                if (command === IpcCommand.GET_FDD_IMAGE) { return failExport ? { ok: false } : { ok: true, data: { data: [1, 2, 3] } }; }
                if (command === IpcCommand.EXIT) { exited.resolve(); }
                return { ok: true };
            },
        };
        const logger = { info() {}, debug() {}, warn() {}, error() {} };
        const lifecycle = new EmulatorLifecycle({ resolve: () => 'emulator' } as any,
            { launch: () => { exited = deferred(); return { spawnResult: { process: { kill() {} }, exitPromise: exited.promise } }; } } as any,
            client as any, logger as any, { resolveExtensionPath: () => 'boot.bin' } as any);
        const persistence = new FddPersistence(client as any, logger as any);
        const registration = lifecycle.registerStopParticipant(context => persistence.persistOnStop(context));
        const executable = path.join(directory, 'original.fdd');
        fs.writeFileSync(executable, Buffer.from([0]));
        const project = { name: 'test', uri: {} as any, run: { executable } };
        if (debug) {
            const request = { program: executable, bootRomPath: 'boot.bin' };
            await lifecycle.startDebug(request);
            await lifecycle.loadDebugProgram(request);
        } else { await lifecycle.start(project); }
        calls.length = 0;
        return { lifecycle, calls, client, executable, project, registration, setFail: (fail: boolean) => { failExport = fail; } };
    }

    for (const action of ['stop', 'display', 'restart', 'shutdown'] as const) {
        it(`persists the loaded FDD before EXIT through ${action}`, async () => {
            const { lifecycle, calls, executable, project } = await fixture();
            // Changing the active project object must not change the captured disk target.
            project.run.executable = path.join(directory, 'different.fdd');
            if (action === 'display') { await lifecycle.stopFromDisplay(); }
            else if (action === 'restart') {
                await lifecycle.restart({ ...project, run: { executable } });
            } else if (action === 'shutdown') { await lifecycle.shutdown(); }
            else { await lifecycle.stop(); }
            assert.deepStrictEqual(fs.readFileSync(executable), Buffer.from([1, 2, 3]));
            assert.ok(calls.indexOf(IpcCommand.RESET_UPDATE_FDD) < calls.indexOf(IpcCommand.EXIT));
            assert.ok(calls.indexOf(IpcCommand.STOP) < calls.indexOf(IpcCommand.GET_FDD_INFO));
        });
    }

    it('coalesces concurrent stops, awaits participants and is idempotent after completion', async () => {
        const { lifecycle, calls } = await fixture();
        const entered = deferred(), gate = deferred();
        lifecycle.registerStopParticipant(async () => { entered.resolve(); await gate.promise; });
        const first = lifecycle.stop();
        assert.strictEqual(lifecycle.stop(), first);
        await entered.promise;
        assert.ok(!calls.includes(IpcCommand.EXIT));
        gate.resolve();
        await first;
        await lifecycle.stop();
        assert.strictEqual(calls.filter(command => command === IpcCommand.GET_FDD_IMAGE).length, 1);
    });

    it('persists debug-loaded disks and carries the read-only launch policy', async () => {
        const { lifecycle, calls, executable } = await fixture(true);
        await lifecycle.stop();
        assert.deepStrictEqual(fs.readFileSync(executable), Buffer.from([1, 2, 3]));
        assert.ok(calls.includes(IpcCommand.GET_FDD_IMAGE));
        const next = await fixture(true);
        await next.lifecycle.loadDebugProgram({ program: next.executable, bootRomPath: 'boot.bin', fddReadOnly: true });
        next.calls.length = 0;
        await next.lifecycle.stop();
        assert.ok(!next.calls.includes(IpcCommand.GET_FDD_IMAGE));
    });

    it('leaves a failed normal save retryable, but shutdown reports and completes teardown', async () => {
        const { lifecycle, calls, client, executable, setFail } = await fixture();
        setFail(true);
        await assert.rejects(lifecycle.stop(), /export/);
        assert.ok(client.connected);
        assert.strictEqual(lifecycle.state, 'connected');
        assert.ok(!calls.includes(IpcCommand.EXIT));
        assert.deepStrictEqual(fs.readFileSync(executable), Buffer.from([0]));
        setFail(false);
        await lifecycle.stop();
        assert.strictEqual(lifecycle.state, 'stopped');
        const next = await fixture();
        next.setFail(true);
        await next.lifecycle.shutdown();
        assert.ok(next.calls.includes(IpcCommand.EXIT));
        assert.strictEqual(next.client.connected, false);
    });

    it('skips persistence for read-only disks and detachable sessions', async () => {
        const first = await fixture();
        first.lifecycle.recordLoadedProgram(first.executable, true);
        await first.lifecycle.stop();
        assert.ok(!first.calls.includes(IpcCommand.GET_FDD_INFO));
        const next = await fixture();
        next.lifecycle.disconnect();
        await next.lifecycle.stop();
        assert.deepStrictEqual(next.calls, []);
    });

    it('unregisters participants and never exports after a stale stop continuation', async () => {
        const { lifecycle, calls, client, registration } = await fixture();
        registration.dispose(); registration.dispose();
        const entered = deferred(), gate = deferred();
        lifecycle.registerStopParticipant(async context => { entered.resolve(); await gate.promise; context.assertCurrent(); });
        const rejected = assert.rejects(lifecycle.stop(), /inactive emulator/);
        await entered.promise;
        client.connectionEpoch++;
        gate.resolve();
        await rejected;
        assert.ok(!calls.includes(IpcCommand.GET_FDD_IMAGE));
        assert.ok(!calls.includes(IpcCommand.EXIT));
        lifecycle.disconnect();
    });

    it('does not clear the dirty flag or exit after a disk write failure', async () => {
        const { lifecycle, calls } = await fixture();
        lifecycle.recordLoadedProgram(directory, false);
        // Use an existing directory with an FDD suffix so writing the image fails.
        const target = path.join(directory, 'folder.fdd');
        fs.mkdirSync(target);
        lifecycle.recordLoadedProgram(target, false);
        await assert.rejects(lifecycle.stop());
        assert.ok(!calls.includes(IpcCommand.RESET_UPDATE_FDD));
        assert.ok(!calls.includes(IpcCommand.EXIT));
        lifecycle.disconnect();
    });
});