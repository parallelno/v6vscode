import { EventEmitter } from 'events';
import { expect } from 'chai';
import { V6DebugAdapter } from '../../../src/debug/adapter/v6-debug-adapter';
import { StopRecord } from '../../../src/emulator/protocol/debug-models';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

describe('V6DebugAdapter stop records', () => {
    function makeAdapter() {
        const lifecycle = Object.assign(new EventEmitter(), {
            serverInfo: undefined,
            connected: true,
            owner: 'debug',
            setExecutionRunning: () => {},
        });
        const viewStops: Array<{ ids: readonly number[]; address?: number }> = [];
        const adapter = new V6DebugAdapter(
            lifecycle as any,
            {} as any,
            { debug: () => {}, error: () => {} } as any,
            {} as any,
            () => ({} as any),
            undefined,
            { showStop: (ids: readonly number[], address?: number) => viewStops.push({ ids, address }) } as any,
        );
        const messages: any[] = [];
        adapter.onDidSendMessage(message => messages.push(message));
        (adapter as any).client = {
            send: async () => ({ ok: true, data: { pc: 0x1234 } }),
        };
        return { adapter, messages, viewStops };
    }

    it('maps an authoritative watchpoint stop to DAP and view feedback', async () => {
        const { adapter, messages, viewStops } = makeAdapter();
        (adapter as any).watchpointIdToDapId.set(7, 41);
        const record: StopRecord = {
            sequence: 2,
            reason: 'watchpoint',
            pc: 0x1234,
            globalInstructionAddress: 0x1234,
            watchpointIds: [7],
            access: 'write',
            accessedGlobalAddress: 0x10000,
            oldValue: 0x10,
            newValue: 0x20,
            description: 'Watchpoint 7 matched',
        };

        await (adapter as any).onStop(record);

        const stopped = messages.find(message => message.event === 'stopped');
        expect(stopped.body).to.include({ reason: 'data breakpoint', description: 'Watchpoint 7 matched' });
        expect(stopped.body.hitBreakpointIds).to.deep.equal([41]);
        expect(messages.find(message => message.event === 'output').body.output)
            .to.contain('Watchpoint 7: write at 0x10000, 0x10 -> 0x20');
        expect(viewStops).to.deep.equal([{ ids: [7], address: 0x10000 }]);
    });

    it('retains exception details for exceptionInfo', async () => {
        const { adapter, messages } = makeAdapter();
        await (adapter as any).onStop({
            sequence: 3,
            reason: 'exception',
            pc: 0x200,
            globalInstructionAddress: 0x200,
            exceptionCode: 'invalidOpcode',
            description: 'Invalid opcode',
        } satisfies StopRecord);

        adapter.handleMessage({ type: 'request', seq: 9, command: 'exceptionInfo', arguments: {} } as any);
        await new Promise(resolve => setImmediate(resolve));

        const response = messages.find(message => message.type === 'response' && message.command === 'exceptionInfo');
        expect(response.success).to.equal(true);
        expect(response.body).to.include({ exceptionId: 'invalidOpcode', description: 'Invalid opcode' });
        expect(messages.find(message => message.event === 'stopped').body.reason).to.equal('exception');
    });

    it('emits a logpoint and resumes without a stopped event', async () => {
        const { adapter, messages } = makeAdapter();
        const commands: IpcCommand[] = [];
        (adapter as any).bpAddrToId.set(0x1234, 7);
        (adapter as any).breakpointsByAddress.set(0x1234, {
            id: 7,
            address: 0x1234,
            logMessage: {
                text: 'B={B}, C={C}',
                segments: [
                    { literal: 'B=' }, { expression: 'B' },
                    { literal: ', C=' }, { expression: 'C' },
                ],
            },
        });
        (adapter as any).client = {
            send: async (command: IpcCommand) => {
                commands.push(command);
                if (command === IpcCommand.GET_REGS) {
                    return { ok: true, data: { pc: 0x1234, af: 0, bc: 0x0E00, de: 0, hl: 0, sp: 0, cc: 0 } };
                }
                return { ok: true };
            },
        };

        await (adapter as any).onStop({
            sequence: 4,
            reason: 'breakpoint',
            pc: 0x1234,
            globalInstructionAddress: 0x1234,
            breakpointAddress: 0x1234,
        } satisfies StopRecord);

        expect(messages.find(message => message.event === 'output').body.output).to.equal('B=0x0E, C=0x00\n');
        expect(messages.find(message => message.event === 'stopped')).to.equal(undefined);
        expect(commands).to.include(IpcCommand.RUN);
    });

    it('polls IS_RUNNING before reading stop details', async () => {
        const { adapter, messages } = makeAdapter();
        const commands: IpcCommand[] = [];
        (adapter as any).stopRecordsSupported = true;
        (adapter as any).lastStopSequence = 4;
        (adapter as any).client = {
            send: async (command: IpcCommand) => {
                commands.push(command);
                if (command === IpcCommand.IS_RUNNING) {
                    return { ok: true, data: { isRunning: false } };
                }
                if (command === IpcCommand.GET_STOP_RECORD) {
                    return {
                        ok: true,
                        data: { sequence: 5, reason: 'pause', pc: 0x100, globalInstructionAddress: 0x100 },
                    };
                }
                if (command === IpcCommand.GET_REGS) {
                    return { ok: true, data: { pc: 0x100 } };
                }
                return { ok: true };
            },
        };

        (adapter as any).startPoll();
        await new Promise(resolve => setTimeout(resolve, 50));
        (adapter as any).stopPoll();

        expect(commands.slice(0, 2)).to.deep.equal([
            IpcCommand.IS_RUNNING,
            IpcCommand.GET_STOP_RECORD,
        ]);
        expect(messages.filter(message => message.event === 'stopped')).to.have.length(1);
    });

    it('clears lifecycle session state when the toolbar action is Alt+Disconnect', async () => {
        let detached = 0;
        let stopped = 0;
        const lifecycle = Object.assign(new EventEmitter(), {
            serverInfo: undefined,
            connected: true,
            owner: 'debug',
            disconnect: () => { detached++; },
            stop: async () => { stopped++; },
            setExecutionRunning: () => {},
        });
        const adapter = new V6DebugAdapter(
            lifecycle as any,
            {} as any,
            { debug: () => {}, error: () => {} } as any,
            {} as any,
            () => ({} as any),
        );
        const messages: any[] = [];
        adapter.onDidSendMessage(message => messages.push(message));
        (adapter as any).client = {
            connected: true,
            send: async () => ({ ok: true }),
        };

        adapter.handleMessage({
            type: 'request', seq: 12, command: 'disconnect', arguments: { terminateDebuggee: false },
        } as any);
        await new Promise(resolve => setImmediate(resolve));

        expect(detached).to.equal(1);
        expect(stopped).to.equal(0);
        expect(messages.find(message => message.command === 'disconnect')?.success).to.equal(true);
        expect(messages.some(message => message.event === 'terminated')).to.equal(true);
    });

    it('stops the emulator lifecycle when the toolbar action is Stop', async () => {
        let stopped = 0;
        let detached = 0;
        const lifecycle = Object.assign(new EventEmitter(), {
            serverInfo: undefined,
            connected: true,
            owner: 'debug',
            disconnect: () => { detached++; },
            stop: async () => { stopped++; },
            setExecutionRunning: () => {},
        });
        const adapter = new V6DebugAdapter(
            lifecycle as any,
            {} as any,
            { debug: () => {}, error: () => {} } as any,
            {} as any,
            () => ({} as any),
        );
        const messages: any[] = [];
        adapter.onDidSendMessage(message => messages.push(message));
        (adapter as any).client = {
            connected: true,
            send: async () => ({ ok: true }),
        };

        adapter.handleMessage({ type: 'request', seq: 13, command: 'terminate', arguments: {} } as any);
        await new Promise(resolve => setImmediate(resolve));

        expect(stopped).to.equal(1);
        expect(detached).to.equal(0);
        expect(messages.find(message => message.command === 'terminate')?.success).to.equal(true);
        expect(messages.some(message => message.event === 'terminated')).to.equal(true);
    });
});