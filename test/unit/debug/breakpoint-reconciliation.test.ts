import { EventEmitter } from 'events';
import { expect } from 'chai';
import { V6DebugAdapter } from '../../../src/debug/adapter/v6-debug-adapter';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

describe('V6DebugAdapter breakpoint reconciliation', () => {
    function makeAdapter() {
        const lifecycle = Object.assign(new EventEmitter(), {
            serverInfo: undefined,
            connected: true,
            owner: 'debug',
            setExecutionRunning: () => {},
        });
        const adapter = new V6DebugAdapter(
            lifecycle as any,
            {} as any,
            { debug: () => {}, error: () => {} } as any,
            {} as any,
            () => ({} as any),
        );
        const commands: Array<{ command: IpcCommand; payload: any }> = [];
        (adapter as any).debugIndex = {
            resolveBreakpoint: (_source: string, line: number) => line === 50
                ? { address: 0x1234, verifiedLine: 50 }
                : undefined,
        };
        (adapter as any).client = {
            send: async (command: IpcCommand, payload: any) => {
                commands.push({ command, payload });
                return { ok: true };
            },
        };
        return { adapter, commands };
    }

    async function setSourceBreakpoints(adapter: V6DebugAdapter, source: string, lines: number[]) {
        await (adapter as any).onSetBreakpoints({
            command: 'setBreakpoints',
            arguments: { source: { path: source }, breakpoints: lines.map(line => ({ line })) },
        });
    }

    it('deletes a source breakpoint from the emulator when VS Code removes it', async () => {
        const { adapter, commands } = makeAdapter();
        await setSourceBreakpoints(adapter, 'C:\\project\\main.asm', [50]);
        commands.length = 0;

        await setSourceBreakpoints(adapter, 'C:\\project\\main.asm', []);

        expect(commands).to.deep.equal([
            { command: IpcCommand.DEBUG_BREAKPOINT_DEL, payload: { addr: 0x1234 } },
        ]);
        expect((adapter as any).bpAddrToId.has(0x1234)).to.equal(false);
    });

    it('keeps a shared backend breakpoint until its last source removes it', async () => {
        const { adapter, commands } = makeAdapter();
        await setSourceBreakpoints(adapter, 'C:\\project\\first.asm', [50]);
        await setSourceBreakpoints(adapter, 'C:\\project\\second.asm', [50]);
        commands.length = 0;

        await setSourceBreakpoints(adapter, 'C:\\project\\first.asm', []);
        expect(commands).to.deep.equal([]);

        await setSourceBreakpoints(adapter, 'C:\\project\\second.asm', []);
        expect(commands).to.deep.equal([
            { command: IpcCommand.DEBUG_BREAKPOINT_DEL, payload: { addr: 0x1234 } },
        ]);
    });

    it('sends parsed condition and hit count to the server breakpoint', async () => {
        const { adapter, commands } = makeAdapter();
        await (adapter as any).onSetBreakpoints({
            command: 'setBreakpoints',
            arguments: {
                source: { path: 'C:\\project\\main.asm' },
                breakpoints: [{ line: 50, condition: 'A == 0x10', hitCondition: '5' }],
            },
        });

        expect(commands).to.deep.include({
            command: IpcCommand.DEBUG_BREAKPOINT_ADD,
            payload: {
                addr: 0x1234,
                memPages: 0x1FFFFFFFF,
                status: 'ACTIVE',
                autoDelete: false,
                operand: 'A',
                condition: 'EQU',
                value: 0x10,
                counter: 5,
                comment: 'dap:1',
            },
        });
    });

    it('rejects malformed hit conditions without adding a backend breakpoint', async () => {
        const { adapter, commands } = makeAdapter();
        await (adapter as any).onSetBreakpoints({
            command: 'setBreakpoints',
            arguments: {
                source: { path: 'C:\\project\\main.asm' },
                breakpoints: [{ line: 50, hitCondition: '>= 5' }],
            },
        });

        expect(commands).to.deep.equal([]);
    });

    it('keeps an acknowledged breakpoint when its replacement configuration is invalid', async () => {
        const { adapter, commands } = makeAdapter();
        await setSourceBreakpoints(adapter, 'C:\\project\\main.asm', [50]);
        commands.length = 0;

        await (adapter as any).onSetBreakpoints({
            command: 'setBreakpoints',
            arguments: {
                source: { path: 'C:\\project\\main.asm' },
                breakpoints: [{ line: 50, hitCondition: 'zero' }],
            },
        });

        expect(commands).to.deep.equal([]);
        expect((adapter as any).bpAddrToId.get(0x1234)).to.equal(1);
    });

    it('rejects a conflicting configuration from another source at the same address', async () => {
        const { adapter, commands } = makeAdapter();
        await (adapter as any).onSetBreakpoints({
            command: 'setBreakpoints',
            arguments: {
                source: { path: 'C:\\project\\first.asm' },
                breakpoints: [{ line: 50, condition: 'A == 1' }],
            },
        });
        commands.length = 0;

        await (adapter as any).onSetBreakpoints({
            command: 'setBreakpoints',
            arguments: {
                source: { path: 'C:\\project\\second.asm' },
                breakpoints: [{ line: 50, condition: 'A == 2' }],
            },
        });

        expect(commands).to.deep.equal([]);
        expect((adapter as any).breakpointsByAddress.get(0x1234).condition.value).to.equal(1);
    });

    it('rejects conflicting configurations at one address in the same source request', async () => {
        const { adapter, commands } = makeAdapter();
        (adapter as any).debugIndex.resolveBreakpoint = (_source: string, line: number) => ({
            address: 0x1234,
            verifiedLine: line,
        });

        await (adapter as any).onSetBreakpoints({
            command: 'setBreakpoints',
            arguments: {
                source: { path: 'C:\\project\\main.asm' },
                breakpoints: [{ line: 50, condition: 'A == 1' }, { line: 51, condition: 'A == 2' }],
            },
        });

        expect(commands.filter(entry => entry.command === IpcCommand.DEBUG_BREAKPOINT_ADD)).to.have.length(1);
        expect((adapter as any).breakpointsByAddress.get(0x1234).condition.value).to.equal(1);
    });

    it('describes active conditional, hit-count, and logpoint behavior', async () => {
        const { adapter, commands } = makeAdapter();
        const messages: any[] = [];
        adapter.onDidSendMessage(message => messages.push(message));

        await (adapter as any).onSetBreakpoints({
            command: 'setBreakpoints',
            arguments: {
                source: { path: 'C:\\project\\main.asm' },
                breakpoints: [{ line: 50, condition: 'HL >= 0x1000', hitCondition: '3', logMessage: 'HL={HL}' }],
            },
        });

        expect(commands).to.have.length(1);
        expect(messages.find(message => message.type === 'response').body.breakpoints[0].message)
            .to.equal('CPU address: 0x1234; condition: HL >= 0x1000; hit count: 3; logpoint');
    });
});