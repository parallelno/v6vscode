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
});