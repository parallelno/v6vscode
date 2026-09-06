import * as assert from 'assert';
import { LogicalLocationIndex } from '../../../src/debug/adapter/logical-location-index';
import { buildDebugIndex } from '../../../src/debug/metadata/debug-index';

describe('LogicalLocationIndex', () => {
    const index = buildDebugIndex([
        { address: 0x100, file: 'main.c', line: 10, column: 1, isStmt: true },
        { address: 0x101, file: 'main.c', line: 10, column: 1, isStmt: true },
        { address: 0x102, file: 'main.c', line: 11, column: 1, isStmt: false },
        { address: 0x103, file: 'main.c', line: 12, column: 1, isStmt: true },
        { address: 0x110, file: 'main.c', line: 10, column: 1, isStmt: true },
        { address: 0x111, file: 'main.c', line: 13, column: 1, isStmt: true },
    ], [], '');
    const metadata = {
        inlineChainAt: (address: number) => address === 0x111 ? [{ id: 9 }] : [],
    };

    it('groups repeated and discontinuous statement rows into one logical statement', () => {
        const locations = new LogicalLocationIndex(index, metadata as any);
        const statement = locations.at(0x100, 'frame-0')!;

        assert.deepStrictEqual(statement.location, {
            physicalFrameId: 'frame-0', inlineChain: [], file: 'main.c', line: 10, column: 1, isStmt: true,
        });
        assert.deepStrictEqual(statement.ranges, [
            { start: 0x100, end: 0x101 },
            { start: 0x101, end: 0x102 },
            { start: 0x110, end: 0x111 },
        ]);
    });

    it('returns distinct in-range statements and ignores non-statement rows', () => {
        const locations = new LogicalLocationIndex(index, metadata as any);
        const statement = locations.at(0x100, 'frame-0')!;
        const next = locations.next(statement, [{ start: 0x100, end: 0x120 }]);

        assert.deepStrictEqual(next.map(candidate => [candidate.location.line, candidate.location.inlineChain]), [
            [13, [9]],
        ]);
    });

    it('returns no statement for an unmapped or non-statement address', () => {
        const locations = new LogicalLocationIndex(index, metadata as any);
        assert.strictEqual(locations.at(0x102, 'frame-0'), undefined);
        assert.strictEqual(locations.at(0x999, 'frame-0'), undefined);
    });

    it('keeps statements with different DWARF discriminators distinct', () => {
        const discriminatorIndex = buildDebugIndex([
            { address: 0x100, file: 'main.c', line: 10, column: 1, isStmt: true, discriminator: 1 },
            { address: 0x101, file: 'main.c', line: 10, column: 1, isStmt: true, discriminator: 2 },
        ], [], '');
        const locations = new LogicalLocationIndex(discriminatorIndex, { inlineChainAt: () => [] } as any);
        const statement = locations.at(0x100, 'frame-0')!;

        assert.deepStrictEqual(locations.next(statement, [{ start: 0x100, end: 0x102 }]).map(candidate => candidate.location.discriminator), [2]);
    });
});