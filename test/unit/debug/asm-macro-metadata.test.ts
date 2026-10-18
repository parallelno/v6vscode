import * as assert from 'assert';
import * as path from 'path';
import { loadDebugArtifact } from '../../../src/debug/metadata/debug-artifact-loader';

const fixtureDir = path.resolve(__dirname, '..', '..', 'fixtures', 'asmdbg');

describe('assembler macro inline metadata', () => {
    let index: any;
    let metadata: any;

    before(async function () {
        const artifact = await loadDebugArtifact(
            path.join(fixtureDir, 'main.elf'),
            path.join(fixtureDir, 'main.rom'),
        );
        index = artifact.index;
        metadata = artifact.metadata;
        assert.ok(metadata, 'Expected semantic metadata from the macro fixture.');
    });

    it('reports inline frames as a metadata feature', () => {
        assert.strictEqual(metadata.features.inlineFrames, true);
    });

    it('resolves the inline chain with the macro name at an expansion address', () => {
        const chain = metadata.inlineChainAt(0x0);
        assert.strictEqual(chain.length, 1);
        assert.strictEqual(metadata.subprogram(chain[0].abstractOrigin)?.name, 'SET_A_ZERO');
    });

    it('resolves nested macro chains innermost first', () => {
        const chain = metadata.inlineChainAt(0x5);
        assert.deepStrictEqual(
            chain.map((scope: any) => metadata.subprogram(scope.abstractOrigin)?.name),
            ['SET_A_ZERO', 'OUTER'],
        );
        assert.strictEqual(chain[0].callLine, 21);
        assert.strictEqual(chain[1].callLine, 28);
    });

    it('synthesizes the enclosing subprogram from the inline region', () => {
        const sub = metadata.subprogramAt(0x0);
        assert.ok(sub, 'Expected a synthesized subprogram at the macro PC.');
        assert.strictEqual(sub.name, 'SET_A_ZERO');
        assert.deepStrictEqual(sub.ranges, [{ start: 0x0, end: 0x1 }]);
    });

    it('keeps physical subprogram lookup free of inline synthesis', () => {
        assert.strictEqual(metadata.physicalSubprogramAt(0x0), undefined);
        assert.strictEqual(metadata.physicalSubprogramAt(0x1), undefined);
    });

    it('resolves physical frame names from symbols rather than macro inline regions', () => {
        const resolveName = (pc: number) =>
            metadata.physicalSubprogramAt(pc)?.name ?? index.symbolAtAddress(pc)?.name;
        assert.strictEqual(resolveName(0x0), 'main');
    });

    it('exposes expansion rows at an address in line-program order', () => {
        assert.deepStrictEqual(
            index.resolveAddressRows(0x0).map((row: any) => row.line),
            [26, 7],
        );
        assert.deepStrictEqual(
            index.resolveAddressRows(0x5).map((row: any) => row.line),
            [21, 7],
        );
        assert.deepStrictEqual(
            index.resolveAddressRows(0x6).map((row: any) => row.line),
            [28, 22],
        );
    });

    it('resolves breakpoints on macro call lines to the expansion entry', () => {
        assert.deepStrictEqual(index.resolveBreakpoint('main.asm', 26), { address: 0x0, verifiedLine: 26 });
        assert.deepStrictEqual(index.resolveBreakpoint('main.asm', 27), { address: 0x1, verifiedLine: 27 });
        assert.deepStrictEqual(index.resolveBreakpoint('main.asm', 28), { address: 0x6, verifiedLine: 28 });
    });

    it('resolves all expansion addresses for a macro body statement', () => {
        const all = index.resolveBreakpointAll('main.asm', 7);
        assert.deepStrictEqual(
            all.map((entry: any) => entry.address).sort((left: number, right: number) => left - right),
            [0x0, 0x5],
        );
    });
});