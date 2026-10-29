import * as assert from 'assert';
import { reconstructFunctionChain } from '../../../src/debug/adapter/function-call-chain-service';
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

describe('assembly function history', () => {
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
        const client = new FunctionHistoryClient({ send: async (_command: number, request: any) => {
            let destination = request.callerCursor === undefined ? 0x400 : instructions[request.callerCursor];
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
        const chain = await reconstructFunctionChain(index(), client, 0x400, () => {});
        assert.deepStrictEqual(chain.map(frame => [frame.name, frame.pc]), [
            ['C', 0x400], ['A', 0x203], [undefined, 0x100],
        ]);
        assert.strictEqual(chain[1].caller?.callerCursor, 3);
    });

    it('rejects stale generation and non-progressing cursor responses', async () => {
        const client = new FunctionHistoryClient({ send: async () => ({ ok: true,
            data: { status: 'found', historyGeneration: 2, callerCursor: 0, callerPc: 1, entrancePc: 2 } }) } as any);
        await assert.rejects(client.caller(2, 3, { historyGeneration: 1, callerCursor: 0 }), /stale/);
    });
});