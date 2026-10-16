import { expect } from 'chai';
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
