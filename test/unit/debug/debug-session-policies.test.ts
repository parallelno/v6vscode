import * as assert from 'assert';
import { BreakpointCoordinator } from '../../../src/debug/session/breakpoint-coordinator';
import { ExecutionController, ExecutionHooks } from '../../../src/debug/session/execution-controller';
import { StopMonitor } from '../../../src/debug/session/stop-monitor';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import { dapRequest } from '../../../src/debug/adapter/dap-protocol';

describe('Debugger session policy owners', () => {
    function breakpoints() {
        const commands: Array<{ command: IpcCommand; data: any }> = [];
        let reject = false;
        const client = { send: async (command: IpcCommand, data: unknown) => {
            commands.push({ command, data }); return { ok: !reject };
        } } as any;
        const coordinator = new BreakpointCoordinator(() => client, () => ({
            index: { resolveBreakpoint: (_file: string, line: number) => ({ address: 0x100 + line, verifiedLine: line }) } as any,
            metadataError: '',
        }));
        return { coordinator, commands, client, reject: () => { reject = true; } };
    }

    it('retains acknowledged condition/configuration when the backend rejects replacement', async () => {
        const { coordinator, reject } = breakpoints();
        const source = { path: 'main.c' };
        await coordinator.setSource({ source, breakpoints: [{ line: 1, condition: 'A == 1' }] });
        reject();
        const result = await coordinator.setSource({ source, breakpoints: [{ line: 1, condition: 'A == 2' }] });
        assert.strictEqual(result[0].verified, false);
        assert.strictEqual(coordinator.at(0x101)?.condition?.value, 1);
        assert.strictEqual(coordinator.idAt(0x101), result[0].id);
    });

    it('reconciles shared source/instruction and temporary references through one owner', async () => {
        const { coordinator, commands } = breakpoints();
        await coordinator.acquireTemporary(0x101);
        await coordinator.setSource({ source: { path: 'main.c' }, breakpoints: [{ line: 1 }] });
        await coordinator.setInstructions({ breakpoints: [{ instructionReference: '0x101' }] });
        commands.length = 0;
        await coordinator.setSource({ source: { path: 'main.c' }, breakpoints: [] });
        assert.strictEqual(commands.length, 0);
        await coordinator.setInstructions({ breakpoints: [] });
        assert.deepStrictEqual(commands.map(value => value.command), [IpcCommand.DEBUG_BREAKPOINT_DEL, IpcCommand.DEBUG_BREAKPOINT_ADD]);
        commands.length = 0;
        await coordinator.releaseTemporary(0x101);
        assert.deepStrictEqual(commands.map(value => value.command), [IpcCommand.DEBUG_BREAKPOINT_DEL]);
    });

    it('serializes concurrent source edits and rejects queued/in-flight work invalidated by clear', async () => {
        const { coordinator, client } = breakpoints();
        let finish!: (response: unknown) => void;
        client.send = () => new Promise(resolve => { finish = resolve; });
        const first = assert.rejects(coordinator.setSource({ source: { path: 'main.c' }, breakpoints: [{ line: 1 }] }), /inactive session/);
        await new Promise(resolve => setImmediate(resolve));
        const second = assert.rejects(coordinator.setInstructions({ breakpoints: [] }), /inactive session/);
        coordinator.clear(); finish({ ok: true });
        await Promise.all([first, second]);
        assert.strictEqual(coordinator.at(0x101), undefined);
    });

    function execution() {
        const commands: IpcCommand[] = [];
        const events: unknown[] = [];
        let valid = true;
        let ok = true;
        const client = { send: async (command: IpcCommand) => { commands.push(command); return { ok }; } } as any;
        const hooks: ExecutionHooks = {
            prepare: async () => { events.push('prepare'); }, synchronize: async () => { events.push('sync'); },
            invalidate: () => { events.push('invalidate'); }, running: value => { events.push(value); },
            continued: () => { events.push('continued'); }, stopped: async () => { events.push('stopped'); },
            refresh: async () => { events.push('refresh'); }, clearException: () => {},
        };
        const controller = new ExecutionController(() => ({ client, records: false, assertCurrent: () => { if (!valid) { throw new Error('inactive'); } } }), hooks);
        return { controller, commands, events, client, hooks, reject: () => { ok = false; }, invalidate: () => { valid = false; } };
    }

    it('does not publish continued/running or poll after a failed RUN', async () => {
        const { controller, reject, events, commands } = execution();
        reject();
        await assert.rejects(controller.run(), /run failed/);
        assert.ok(!events.includes('continued')); assert.ok(!events.includes(true));
        assert.deepStrictEqual(commands, [IpcCommand.RUN]);
    });

    it('keeps reset/reload command order explicit and resumes only after successful controls', async () => {
        const { controller, commands, events } = execution();
        controller.state = 'running';
        await controller.restart('reset'); controller.stopPoll();
        assert.deepStrictEqual(commands, [IpcCommand.STOP, IpcCommand.RESET, IpcCommand.RUN]);
        commands.length = 0;
        await controller.restart('reload', async () => { events.push('load'); }); controller.stopPoll();
        assert.deepStrictEqual(commands, [IpcCommand.STOP, IpcCommand.RESET, IpcCommand.RESTART, IpcCommand.DEBUG_RESET, IpcCommand.RUN]);
        assert.ok(events.includes('load'));
    });

    it('prevents a failed or stale reset from executing later commands', async () => {
        const { controller, commands, client, invalidate } = execution();
        client.send = async (command: IpcCommand) => { commands.push(command); invalidate(); return { ok: true }; };
        await assert.rejects(controller.restart('reset'), /inactive/);
        assert.deepStrictEqual(commands, [IpcCommand.STOP]);
    });

    it('suppresses a delayed poll result after invalidation', async () => {
        const monitor = new StopMonitor(1);
        let finish!: (response: unknown) => void;
        let stops = 0;
        const client = { send: () => new Promise(resolve => { finish = resolve; }) } as any;
        monitor.start(client, () => ({ records: false, pauseRequested: false }), async () => { stops++; });
        await new Promise(resolve => setTimeout(resolve, 10));
        monitor.stop(); finish({ ok: true, data: { isRunning: false } });
        await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(stops, 0);
    });

    it('rejects malformed DAP envelopes while preserving ordinary requests', () => {
        for (const value of [null, {}, { type: 'event', seq: 1, command: 'next' }, { type: 'request', seq: 1, command: 'next', arguments: [] }]) {
            assert.strictEqual(dapRequest(value), undefined);
        }
        const request = { type: 'request', seq: 1, command: 'next', arguments: { granularity: 'instruction' } };
        assert.strictEqual(dapRequest(request), request);
    });
});