import { expect } from 'chai';
import { SHN_ABS } from '../../../src/debug/metadata/elf32-reader';
import { buildDebugIndex } from '../../../src/debug/metadata/debug-index';

function buildIndexWithFiles(files: string[]) {
    const rows = files.map((file, index) => ({
        address: 0x100 + index,
        file,
        line: 10 + index,
        column: 1,
        isStmt: true,
    }));
    return buildDebugIndex(rows, [], '', [], []);
}

describe('DebugIndex breakpoint file resolution', () => {
    it('resolves a breakpoint path rooted at a different location by trailing segments', () => {
        const index = buildIndexWithFiles([
            'C:\\work\\v6gel\\engine\\common\\v6_consts.asm',
            'C:\\work\\v6gel\\samples\\09_x\\main.asm',
        ]);
        const breakpointPath = 'C:\\repos\\mirror\\samples\\09_x\\main.asm';
        const resolved = index.resolveBreakpoint(breakpointPath, 11);
        expect(resolved).to.deep.equal({ address: 0x101, verifiedLine: 11 });
    });

    it('resolves a breakpoint path against engine sources with a different root', () => {
        const index = buildIndexWithFiles([
            'C:\\work\\v6gel\\engine\\gfx\\v6_sprite_draw.asm',
            'C:\\work\\v6gel\\samples\\09_x\\main.asm',
        ]);
        const breakpointPath = 'C:\\repos\\mirror\\engine\\gfx\\v6_sprite_draw.asm';
        const resolved = index.resolveBreakpoint(breakpointPath, 10);
        expect(resolved).to.deep.equal({ address: 0x100, verifiedLine: 10 });
    });

    it('still prefers an exact path match', () => {
        const exact = 'C:\\work\\v6gel\\samples\\09_x\\main.asm';
        const index = buildIndexWithFiles([exact, 'C:\\work\\v6gel\\samples\\09_x\\other.asm']);
        const resolved = index.resolveBreakpoint(exact, 10);
        expect(resolved).to.deep.equal({ address: 0x100, verifiedLine: 10 });
    });

    it('leaves a breakpoint unresolved when the best trailing match is ambiguous', () => {
        const index = buildIndexWithFiles([
            'C:\\work\\v6gel\\samples\\a\\main.asm',
            'C:\\work\\v6gel\\samples\\b\\main.asm',
        ]);
        expect(index.resolveBreakpoint('C:\\repos\\mirror\\main.asm', 10)).to.equal(undefined);
    });

    it('matches case-insensitively on Windows-style absolute paths', () => {
        const index = buildIndexWithFiles(['C:\\Work\\V6gel\\samples\\09_x\\Main.asm']);
        const resolved = index.resolveBreakpoint('C:\\REPOS\\mirror\\SAMPLES\\09_x\\main.asm', 10);
        expect(resolved).to.deep.equal({ address: 0x100, verifiedLine: 10 });
    });

    it('leaves a breakpoint unresolved when no segment matches', () => {
        const index = buildIndexWithFiles(['C:\\work\\v6gel\\samples\\09_x\\main.asm']);
        expect(index.resolveBreakpoint('C:\\elsewhere\\unrelated\\notes.txt', 10)).to.equal(undefined);
    });

    it('slides to the next statement row in the matched file', () => {
        const file = 'C:\\work\\v6gel\\samples\\09_x\\main.asm';
        const rows = [
            { address: 0x100, file, line: 10, column: 1, isStmt: true },
            { address: 0x140, file, line: 20, column: 1, isStmt: true },
        ];
        const index = buildDebugIndex(rows, [], '', [], []);
        const resolved = index.resolveBreakpoint('C:\\repos\\mirror\\samples\\09_x\\main.asm', 15);
        expect(resolved).to.deep.equal({ address: 0x140, verifiedLine: 20 });
    });
});

describe('DebugIndex data labels and scan pool', () => {
    it('includes untyped labels from real sections as navigable symbols', () => {
        const index = buildDebugIndex([], [
            { name: 'lv_ram_disk_s_gfx', value: 0x667e, size: 0, type: 0, binding: 1, section: 3 },
        ], '', [], []);
        expect(index.symbol('lv_ram_disk_s_gfx')).to.include({ name: 'lv_ram_disk_s_gfx', address: 0x667e });
    });

    it('keeps absolute constants in the symbol index', () => {
        const index = buildDebugIndex([], [
            { name: 'SCR_BUFF0_ADDR', value: 0x8000, size: 0, type: 0, binding: 1, section: SHN_ABS },
        ], '', [], []);
        expect(index.symbol('SCR_BUFF0_ADDR')).to.include({ name: 'SCR_BUFF0_ADDR', address: 0x8000 });
    });

    it('merges absolute constants duplicated across objects instead of making them ambiguous', () => {
        const index = buildDebugIndex([], [
            { name: 'SCR_BUFF0_ADDR', value: 0x8000, size: 0, type: 0, binding: 1, section: SHN_ABS },
            { name: 'SCR_BUFF0_ADDR', value: 0x8000, size: 0, type: 0, binding: 1, section: SHN_ABS },
        ], '', [], []);
        expect(index.symbol('SCR_BUFF0_ADDR')).to.include({ name: 'SCR_BUFF0_ADDR', address: 0x8000 });
        expect(index.symbols('SCR_BUFF0_ADDR')).to.have.length(1);
    });

    it('keeps same-name constants with different values ambiguous', () => {
        const index = buildDebugIndex([], [
            { name: 'BANK', value: 0x0001, size: 0, type: 0, binding: 1, section: SHN_ABS },
            { name: 'BANK', value: 0x0002, size: 0, type: 0, binding: 1, section: SHN_ABS },
        ], '', [], []);
        expect(index.symbol('BANK')).to.equal(undefined);
        expect(index.symbols('BANK')).to.have.length(2);
    });

    it('adds line-table files without code rows to the source file pool', () => {
        const dataFile = 'C:\\work\\v6gel\\engine\\v6_runtime_data.asm';
        const index = buildDebugIndex(
            [{ address: 0x100, file: 'C:\\work\\v6gel\\engine\\v6.asm', line: 1, column: 1, isStmt: true }],
            [],
            '',
            [],
            [dataFile],
        );
        expect(index.sourceFiles).to.include(dataFile);
    });
});
