import { EventEmitter } from 'events';
import { expect } from 'chai';
import { V6DebugAdapter } from '../../../src/debug/adapter/v6-debug-adapter';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import { ExecutionController } from '../../../src/debug/session/execution-controller';
import { decodeRecorderStatus } from '../../../src/emulator/protocol/recorder-models';

describe('V6DebugAdapter restart actions', () => {
    const adapters: V6DebugAdapter[] = [];

    afterEach(() => {
        for (const adapter of adapters) {
            (adapter as any).stopPoll();
        }
        adapters.length = 0;
    });

    function makeAdapter() {
        const reloaded: unknown[] = [];
        const lifecycle = Object.assign(new EventEmitter(), {
            connected: true,
            owner: 'debug',
            setExecutionRunning: () => {},
            reloadDebugRom: async (request: unknown) => { reloaded.push(request); },
        });
        const adapter = new V6DebugAdapter(
            lifecycle as any,
            {} as any,
            { debug: () => {}, error: () => {} } as any,
            {} as any,
            () => ({} as any),
        );
        adapters.push(adapter);
        const requests: Array<{ command: IpcCommand; data: unknown }> = [];
        (adapter as any).client = {
            send: async (command: IpcCommand, data: unknown) => {
                requests.push({ command, data });
                return { ok: true };
            },
        };
        return { adapter, requests, reloaded };
    }

    it('resets hardware and resumes an executing session', async () => {
        const { adapter, requests } = makeAdapter();
        (adapter as any).execution.state = 'running';

        await adapter.reset();

        expect(requests).to.deep.equal([
            { command: IpcCommand.STOP, data: undefined },
            { command: IpcCommand.RESET, data: undefined },
            { command: IpcCommand.DEBUG_BREAKPOINT_GET_ALL, data: undefined },
            { command: IpcCommand.RUN, data: undefined },
        ]);
    });

    it('reloads ROM data before resetting debugger state and running', async () => {
        const { adapter, requests, reloaded } = makeAdapter();
        const request = { program: 'test.rom' };
        (adapter as any).launchRequest = request;

        await adapter.reloadRom();

        expect(requests).to.deep.equal([
            { command: IpcCommand.STOP, data: undefined },
            { command: IpcCommand.RESET, data: undefined },
            { command: IpcCommand.RESTART, data: undefined },
            { command: IpcCommand.DEBUG_RESET, data: { resetRecorder: true } },
            { command: IpcCommand.DEBUG_BREAKPOINT_GET_ALL, data: undefined },
            { command: IpcCommand.RUN, data: undefined },
        ]);
        expect(reloaded).to.deep.equal([request]);
    });

    it('rejects ROM reload for an FDD session', async () => {
        const { adapter } = makeAdapter();
        (adapter as any).launchRequest = { program: 'test.fdd' };

        let message = '';
        try {
            await adapter.reloadRom();
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.contain('only available for ROM');
    });
});

describe('Recorder debugger control', () => {
    it('publishes a stopped refresh without continuing and ignores a no-op', async () => {
        const status = decodeRecorderStatus({ attached: true, running: false, revision: 7, frameCheckpoints: 0,
            frameStepsBack: 0, frameStepsForward: 0, instructionStepsBack: 0, instructionStepsForward: 1,
            position: { id: 1, pc: 0x100, frameNumber: 0, atFrameCheckpoint: false, atRecordedTip: false },
            timeline: { oldest: 1, newest: 2, instructionStart: 1, frameTicks: [], instructionTicks: [1, 2] } });
        const calls: string[] = [];
        const client = { send: async () => ({ ok: true, data: { sequence: 8, reason: 'step', pc: 0x100, globalInstructionAddress: 0x100 } }) };
        const controller = new ExecutionController(() => ({ client: client as never, records: true, assertCurrent() {} }), {
            prepare: async () => { calls.push('prepare'); }, synchronize: async () => {},
            invalidate: () => calls.push('invalidate'), running: () => calls.push('running'),
            continued: () => calls.push('continued'), stopped: async record => { calls.push(`stop:${record?.sequence}`); },
            refresh: async () => {}, clearException: () => calls.push('clearException'),
        });
        controller.state = 'paused';
        await controller.restorePosition(async () => ({ status, stopSequence: 8 }));
        await controller.restorePosition(async () => ({ status }));
        expect(calls).to.deep.equal(['prepare', 'invalidate', 'clearException', 'stop:8', 'prepare']);
        expect(controller.state).to.equal('paused');
    });
});