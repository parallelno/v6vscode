import * as assert from 'assert';
import { V6DebugAdapter } from '../../../src/debug/adapter/v6-debug-adapter';
import { ASSEMBLER_HOVER_CONTEXT } from '../../../src/debug/values/evaluation-context';
import { ASM_HOVER_REQUEST, AsmHoverTarget, instructionByteCount } from '../../../src/debug/values/asm-hover';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import { TypeInfo } from '../../../src/debug/metadata/dwarf-types';
import { STT_FUNC } from '../../../src/debug/metadata/elf32-reader';

function makeAdapter(sourceFile = 'main.asm') {
    const adapter = new V6DebugAdapter({} as any, {} as any, { debug() {}, error() {} } as any, {} as any, () => ({} as any));
    const state = adapter as any;
    const byte: TypeInfo = { id: 1, kind: 'base', name: 'byte', byteSize: 1, signed: false };
    const word: TypeInfo = { id: 2, kind: 'base', name: 'word', byteSize: 2, signed: false };
    const record: TypeInfo = {
        id: 3, kind: 'structure', name: 'Record', byteSize: 3, signed: false,
        members: [{ name: 'health', offset: 0, type: byte }, { name: 'ptr', offset: 1, type: word }],
    };
    const pool: TypeInfo = { id: 4, kind: 'array', name: 'Record[]', byteSize: 6, signed: false, of: record, count: 2 };
    const variables = [
        { id: 1, name: 'instance', kind: 'global', typeOffset: 3, address: 0x1000 },
        { id: 2, name: 'pool', kind: 'global', typeOffset: 4, address: 0x1003 },
        { id: 3, name: 'parameter', kind: 'parameter', typeOffset: 2, constValue: 7 },
    ];
    const symbols: Record<string, any[]> = {
        set_timer: [{ address: 0x422, size: 12, type: STT_FUNC }],
        instance: [{ address: 0x1000, size: 1 }],
        pool: [{ address: 0x1003, size: 1 }],
        CONSTANT: [{ address: 0x7500, size: 0, absolute: true }],
        'Record.ptr': [{ address: 1, size: 0, absolute: true }],
        raw: [{ address: 0x1001, size: 2 }],
    };
    const reads: Array<{ address: number; size: number }> = [];
    const memory = new Uint8Array([100, 255, 255, 100, 255, 255, 100, 255, 255]);
    state.stoppedGeneration = 1;
    state.cachedRegs = { af: 0x1002, bc: 0, de: 0, hl: 0x1000, sp: 0x8000, pc: 0x100, m: 100 };
    state.debugMetadata = {
        variablesAt: () => variables,
        scopes: { variables },
        resolveAbstractOrigin: (variable: unknown) => variable,
        typeOf: (id: number) => [undefined, byte, word, record, pool][id],
        evaluateVariable: (variable: any) => ({ kind: 'memory', address: variable.address }),
    };
    state.debugIndex = {
        symbols: (name: string) => symbols[name] ?? [],
        sourceFiles: [sourceFile],
        resolveAddress: () => ({ file: sourceFile, line: 92 }),
    };
    state.stopContext = {
        pc: 0x100, sp: 0x8000, topRegisters: { 0: 16, 9: 0x1000 }, evalContext: () => ({}),
        memory: { readBytes: async (address: number, size: number) => {
            reads.push({ address, size });
            return memory.slice(address - 0x1000, address - 0x1000 + size);
        } },
    };
    state.stackTraceService.frame = (_generation: number, id: number) => id === 100 ? {
        name: 'main', instructionPc: 0x100, source: { file: sourceFile },
        physicalFrame: { pc: 0x100, registers: { 0: 16, 9: 0x1000 } },
    } : undefined;
    let seq = 0;
    const request = (command: string, args: unknown): Promise<any> => new Promise((resolve, reject) => {
        const requestSeq = ++seq;
        const timer = setTimeout(() => { subscription.dispose(); reject(new Error(`Timed out: ${command}`)); }, 1000);
        const subscription = adapter.onDidSendMessage((message: any) => {
            if (message.type === 'response' && message.request_seq === requestSeq) {
                clearTimeout(timer);
                subscription.dispose();
                resolve(message);
            }
        });
        adapter.handleMessage({ type: 'request', seq: requestSeq, command, arguments: args } as any);
    });
    const evaluate = (expression: string, context = 'watch', frameId?: number) => request('evaluate', { expression, context, frameId });
    return { state, request, evaluate, reads };
}

describe('Unified debugger value presentation', () => {
    it('uses DWARF types for Watch, Console and ASM hover, with and without a selected frame', async () => {
        const { evaluate, reads } = makeAdapter();
        for (const frameId of [undefined, 100]) {
            for (const context of ['watch', 'repl', ASSEMBLER_HOVER_CONTEXT]) {
                for (const expression of ['instance.ptr', 'pool[0].ptr', 'pool[1].ptr']) {
                    const response = await evaluate(expression, context, frameId);
                    assert.strictEqual(response.success, true, response.message);
                    assert.strictEqual(response.body.result, '65535');
                    assert.strictEqual(response.body.type, 'word');
                }
                const summary = await evaluate('instance', context, frameId);
                assert.strictEqual(summary.body.result, '0x1000 {health = 100, ptr = 65535}');
                assert.ok(summary.body.variablesReference > 0);
            }
        }
        assert.ok(reads.some(read => read.address === 0x1001 && read.size === 2));
    });

    for (const watchFirst of [true, false]) {
        it(`keeps Parameters and Globals independent from expandable Watch/pool handles (Watch first: ${watchFirst})`, async () => {
            const { evaluate, request } = makeAdapter();
            let watch: any;
            if (watchFirst) { watch = (await evaluate('pool')).body; }
            const scopes = (await request('scopes', { frameId: 100 })).body.scopes;
            if (!watchFirst) { watch = (await evaluate('pool')).body; }
            const parametersRef = scopes.find((scope: any) => scope.name === 'Parameters').variablesReference;
            const globalsRef = scopes.find((scope: any) => scope.name === 'Globals').variablesReference;
            assert.notStrictEqual(watch.variablesReference, parametersRef);
            const globals = (await request('variables', { variablesReference: globalsRef })).body.variables;
            assert.deepStrictEqual(globals.map((variable: any) => variable.name), ['instance', 'pool']);
            const elements = (await request('variables', { variablesReference: watch.variablesReference })).body.variables;
            assert.deepStrictEqual(elements.map((variable: any) => variable.name), ['[0]', '[1]']);
            assert.strictEqual(elements[0].value, '0x1003 {health = 100, ptr = 65535}');
            const fields = (await request('variables', { variablesReference: elements[0].variablesReference })).body.variables;
            assert.strictEqual(fields[1].value, '65535');
            for (let index = 0; index < 2; index++) {
                const parameters = (await request('variables', { variablesReference: parametersRef })).body.variables;
                assert.deepStrictEqual(parameters.map((variable: any) => [variable.name, variable.value]), [['parameter', '7']]);
            }
        });
    }

    it('returns function addresses consistently and never reads instruction bytes as data', async () => {
        const { evaluate, reads } = makeAdapter();
        for (const frameId of [undefined, 100]) {
            for (const context of ['watch', 'repl', ASSEMBLER_HOVER_CONTEXT]) {
                const response = await evaluate('set_timer', context, frameId);
                assert.strictEqual(response.body.result, '0x0422');
                assert.strictEqual(response.body.variablesReference, 0);
            }
        }
        assert.deepStrictEqual(reads, []);
    });

    it('shows mapped memory for M, every register pair, and code and data labels during a selected stop', async () => {
        const { state, request } = makeAdapter();
        state.execution.state = 'paused';
        const byteReads: number[] = [];
        state.client = { send: async (command: IpcCommand, { addr }: { addr: number }) => {
            assert.strictEqual(command, IpcCommand.GET_BYTE_RAM);
            byteReads.push(addr);
            return { ok: true, data: { data: addr === 0x422 ? 0xC9 : addr === 0x1000 ? 0 : 0x42 } };
        } };
        const hover = async (hoverTarget: AsmHoverTarget) => {
            const response = await request(ASM_HOVER_REQUEST, { hoverTarget, frameId: 100 });
            assert.strictEqual(response.success, true, response.message);
            return response.body.rows.map((row: { value: number }) => row.value);
        };
        assert.deepStrictEqual(await hover({ kind: 'register', name: 'M' }), [0x1000, 0]);
        for (const [name, value] of Object.entries({ A: 16, F: 2, B: 0, C: 0, D: 0, E: 0, H: 16, L: 0 })) {
            assert.deepStrictEqual(await hover({ kind: 'register', name }), [value]);
        }
        for (const [name, value] of Object.entries({ AF: 0x1002, BC: 0, DE: 0, HL: 0x1000, SP: 0x8000, PC: 0x100 })) {
            assert.deepStrictEqual(await hover({ kind: 'register', name }), [value, value === 0x1000 ? 0 : 0x42]);
        }
        assert.deepStrictEqual(await hover({ kind: 'symbol', name: 'set_timer' }), [0x422, 0xC9]);
        assert.deepStrictEqual(await hover({ kind: 'symbol', name: 'instance' }), [0x1000, 0]);
        assert.deepStrictEqual(await hover({ kind: 'symbol', name: 'instance.ptr' }), [0x1001, 65535]);
        assert.deepStrictEqual(await hover({ kind: 'symbol', name: 'Record.ptr' }), [1]);
        assert.ok(!byteReads.includes(1), 'absolute constants are not dereferenced');
        state.client.send = async () => ({ ok: false });
        assert.deepStrictEqual(await hover({ kind: 'symbol', name: 'set_timer' }), [0x422, undefined]);
        state.client.send = async () => {
            state.stoppedGeneration++;
            return { ok: true, data: { data: 0xC9 } };
        };
        const stale = await request(ASM_HOVER_REQUEST, { hoverTarget: { kind: 'symbol', name: 'set_timer' } });
        assert.strictEqual(stale.success, false);
        assert.match(stale.message, /inactive stop/);
        state.execution.state = 'running';
        assert.strictEqual((await request(ASM_HOVER_REQUEST, { hoverTarget: { kind: 'register', name: 'M' } })).success, false);
    });

    it('uses exact source rows and the live opcode to display operand bytes in order', async () => {
        const { state, request } = makeAdapter();
        state.execution.state = 'paused';
        state.debugIndex.resolveBreakpointAll = (_file: string, line: number) => line === 5
            ? [{ address: 0x100 }, { address: 0x105 }] : [];
        let data = 0x1234CD;
        state.client = { send: async (command: IpcCommand, args: { addr: number }) => {
            assert.strictEqual(command, IpcCommand.GET_THREE_BYTES_RAM);
            assert.strictEqual(args.addr, 0x100);
            return { ok: true, data: { data } };
        } };
        const hover = (line: number) => request(ASM_HOVER_REQUEST, { hoverTarget: { kind: 'instruction', file: 'main.asm', line } });
        assert.deepStrictEqual((await hover(4)).body.rows, []);
        assert.deepStrictEqual((await hover(5)).body.rows.map((row: { value: number }) => row.value), [0x100, 0xCD, 0x34, 0x12]);
        data = 0x1234C9;
        assert.deepStrictEqual((await hover(5)).body.rows[2], { label: 'Operand bytes', note: 'none' });
        assert.strictEqual(instructionByteCount(0x36), 2);
        assert.strictEqual(instructionByteCount(0xDB), 2);
        assert.strictEqual(instructionByteCount(0xFD), 3);
        state.cachedRegs.pc = 0x108;
        assert.deepStrictEqual((await hover(5)).body.rows, []);
    });

    it('declines only competing native ASM hovers, retaining C and language-owned hovers', async () => {
        const asm = makeAdapter();
        assert.strictEqual((await asm.evaluate('instance.ptr', 'hover', 100)).success, false);
        assert.strictEqual((await asm.evaluate('instance.ptr', ASSEMBLER_HOVER_CONTEXT, 100)).body.result, '65535');
        const c = makeAdapter('main.c');
        assert.strictEqual((await c.evaluate('instance.ptr', 'hover', 100)).body.result, '65535');
    });

    it('keeps register width formatting consistent across selected and default frames', async () => {
        const { evaluate } = makeAdapter();
        for (const frameId of [undefined, 100]) {
            assert.strictEqual((await evaluate('A', 'watch', frameId)).body.result, '0x10');
            assert.strictEqual((await evaluate('HL', 'watch', frameId)).body.result, '0x1000');
        }
    });

    it('rejects stale frames and unavailable memory rather than substituting an address as a value', async () => {
        const { state, evaluate } = makeAdapter();
        const stale = await evaluate('instance.ptr', 'watch', 999);
        assert.strictEqual(stale.success, false);
        assert.match(stale.message, /no longer available/);
        state.stopContext.memory.readBytes = async () => undefined;
        const unreadable = await evaluate('raw');
        assert.strictEqual(unreadable.success, false);
        assert.match(unreadable.message, /unreadable/);
    });

    it('bounds language-owned ASM hover latency as well as native hover latency', async () => {
        const { state } = makeAdapter();
        state.valueEvaluationService = { evaluate: () => new Promise(() => {}) };
        await assert.rejects(() => state.evaluateExpression(ASSEMBLER_HOVER_CONTEXT, 'instance', {}), /Hover evaluation timed out/);
    });
    it('does not resolve delayed Variables requests to a new stop', async () => {
        const { state, request, evaluate } = makeAdapter();
        const old = (await evaluate('pool')).body.variablesReference;
        state.stoppedGeneration++;
        const next = (await evaluate('instance')).body.variablesReference;
        assert.notStrictEqual(old, next);
        assert.deepStrictEqual((await request('variables', { variablesReference: old })).body.variables, []);
        assert.strictEqual((await request('variables', { variablesReference: next })).body.variables[1].value, '65535');
    });
});
