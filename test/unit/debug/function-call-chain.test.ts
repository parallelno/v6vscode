import * as assert from 'assert';
import { activeFunctionChain, hybridFunctionChain, reconstructFunctionChain } from '../../../src/debug/adapter/function-call-chain-service';
import { AsmFunctionIndex } from '../../../src/debug/metadata/asm-function-index';
import { DW_AT, DW_FORM } from '../../../src/debug/metadata/dwarf-reader';
import { FunctionHistoryClient } from '../../../src/debug/session/function-history-client';
import * as path from 'path';
import { loadDebugArtifact } from '../../../src/debug/metadata/debug-artifact-loader';

function index(): AsmFunctionIndex {
    const attr = (name: number, value: number | string) => ({ name, value, form: DW_FORM.data4 });
    const region = (offset: number, start: number, name: string) => ({ offset, tag: 0x4080,
        hasChildren: true, attributes: [attr(DW_AT.low_pc, start), attr(DW_AT.high_pc, 0x10)],
        children: [{ offset: offset + 1, tag: 3, hasChildren: false, children: [], attributes: [
            attr(DW_AT.name, name), attr(DW_AT.low_pc, start), attr(0x3f01, 'main.asm'), attr(DW_AT.decl_line, 2),
        ] }] });
    return new AsmFunctionIndex([{ root: { offset: 0, tag: 0x11, hasChildren: true, attributes: [],
        children: [region(10, 0x200, 'A'), region(20, 0x300, 'B'), region(30, 0x400, 'C'),
            region(40, 0xFFFF, 'discarded')] } } as any]);
}

function recordedHistory(instructions: number[], livePc: number): FunctionHistoryClient {
    return new FunctionHistoryClient({ send: async (_command: number, request: any) => {
        let destination = request.callerCursor === undefined ? livePc : instructions[request.callerCursor];
        for (let cursor = request.callerCursor === undefined ? 0 : request.callerCursor + 1;
            cursor < instructions.length; cursor++) {
            const pc = instructions[cursor];
            if (pc < request.rangeStart || pc >= request.rangeEnd) {
                return { ok: true, data: { status: 'found', historyGeneration: 1,
                    callerPc: pc, entrancePc: destination, callerCursor: cursor } };
            }
            destination = pc;
        }
        return { ok: true, data: { status: 'historyEnd', historyGeneration: 1 } };
    } } as any);
}

describe('assembly function history', () => {
    it('keeps recursive activations and follows callers without assembler regions', () => {
        const calls = [{ callerPc: 0x205, entryPc: 0x200, returnPc: 0x208 },
            { callerPc: 0x105, entryPc: 0x200, returnPc: 0x108 },
            { callerPc: 0x80, entryPc: 0x100, returnPc: 0x83 }];
        const names = new Map([[0x105, 'plain_label'], [0x80, 'main']]);
        assert.deepStrictEqual(activeFunctionChain(index(), calls, 0x203, pc => names.get(pc))
            .map(frame => [frame.name, frame.pc, frame.returnPc]), [
            ['A', 0x203, 0x208], ['A', 0x205, 0x108], ['plain_label', 0x105, 0x83], ['main', 0x80, undefined],
        ]);
    });

    it('decodes real ROM and linked GC artifacts and filters the discarded optional region', async () => {
        for (const name of ['functions', 'functions-linked']) {
            const root = path.resolve(__dirname, '..', '..', 'fixtures', 'asmdbg');
            const artifact = await loadDebugArtifact(path.join(root, `${name}.elf`), path.join(root, `${name}.rom`));
            const regions = artifact.metadata!.asmFunctions.regions;
            assert.strictEqual(regions.length, 3, name);
            assert.deepStrictEqual(regions.flatMap(region => region.entries.map(entry => entry.name)).sort(),
                ['emit', 'helper', 'prepare', 'prepare_fast']);
            const entry = regions.flatMap(region => region.entries).find(entry => entry.name === 'prepare_fast')!;
            assert.strictEqual(artifact.index.symbol('prepare_fast')?.declaration?.line, entry.line);
        }
    });
    it('indexes live regions and rejects tombstones before constructing ranges', () => {
        const functions = index();
        assert.strictEqual(functions.regions.length, 3);
        assert.strictEqual(functions.at(0x205)?.entries[0].name, 'A');
        assert.strictEqual(functions.at(0xFFFF), undefined);
    });

    it('collapses completed helper excursions and retains the newer caller site', async () => {
        // Chronological: main calls A, A calls B, B returns, A calls C.
        const instructions = [0x203, 0x300, 0x200, 0x100]; // newest first
        const client = recordedHistory(instructions, 0x400);
        const chain = await reconstructFunctionChain(index(), client, 0x400, () => {});
        assert.deepStrictEqual(chain.map(frame => [frame.name, frame.pc]), [
            ['C', 0x400], ['A', 0x203], [undefined, 0x100],
        ]);
        assert.strictEqual(chain[1].caller?.callerCursor, 3);
    });

    it('keeps an active jump caller but collapses the loop after it jumps back', async () => {
        const functions = index();
        const capture = (pc: number, instructions: number[], traceCursor: number | null) => hybridFunctionChain(
            functions, recordedHistory(instructions, pc), { historyGeneration: 1,
                frames: [{ callerPc: 0x100, entryPc: 0x200, returnPc: 0x103, traceCursor }] },
            pc, () => undefined, () => {});
        const active = await capture(0x300, [0x200, 0x100], 1);
        assert.deepStrictEqual(active.map(frame => [frame.pc, frame.caller?.callerCursor, frame.returnPc]), [
            [0x300, 0, undefined], [0x200, undefined, 0x103], [0x100, undefined, undefined],
        ]);
        const completed = await capture(0x400, [0x203, 0x300, 0x200, 0x100], 3);
        assert.deepStrictEqual(completed.map(frame => [frame.pc, frame.returnPc]), [
            [0x400, undefined], [0x203, 0x103], [0x100, undefined],
        ]);
        const expired = await capture(0x300, [0x200], null);
        assert.deepStrictEqual(expired.map(frame => frame.pc), [0x300, 0x200, 0x100]);
    });

    it('does not collapse recursive hardware calls while scanning region loops', async () => {
        const chain = await hybridFunctionChain(index(), recordedHistory([0x200, 0x300, 0x205, 0x200, 0x100], 0x203),
            { historyGeneration: 1, frames: [{ callerPc: 0x205, entryPc: 0x200, returnPc: 0x208, traceCursor: 2 },
                { callerPc: 0x100, entryPc: 0x200, returnPc: 0x103, traceCursor: 4 }] },
            0x203, () => undefined, () => {});
        assert.deepStrictEqual(chain.map(frame => [frame.pc, frame.returnPc]), [
            [0x203, 0x208], [0x205, 0x103], [0x100, undefined],
        ]);
    });

    it('rejects stale generation and non-progressing cursor responses', async () => {
        const client = new FunctionHistoryClient({ send: async () => ({ ok: true,
            data: { status: 'found', historyGeneration: 2, callerCursor: 0, callerPc: 1, entrancePc: 2 } }) } as any);
        await assert.rejects(client.caller(2, 3, { historyGeneration: 1, callerCursor: 0 }), /stale/);
    });
});