import { expect } from 'chai';
import {
    decodeWatchpointList,
    validateWatchpointConfig,
} from '../../../src/debug/watchpoints/watchpoint-validator';

describe('watchpoint runtime validation', () => {
    const base = {
        globalAddr: 0x10000, len: 1, value: 0xFF, access: 'RW',
        condition: 'EQU', type: 'LEN', active: true, comment: 'screen',
    };

    it('accepts valid LEN and WORD configurations', () => {
        expect(validateWatchpointConfig(base)).to.deep.equal(base);
        expect(validateWatchpointConfig({ ...base, len: 2, value: 0xFFFF, type: 'WORD' }).type).to.equal('WORD');
    });

    it('rejects unknown fields, incompatible widths, overflow, and oversized UTF-8 comments', () => {
        for (const candidate of [
            { ...base, id: 1 },
            { ...base, value: 0x100 },
            { ...base, type: 'WORD', len: 1 },
            { ...base, globalAddr: 0x20FFFF, len: 2 },
            { ...base, comment: 'é'.repeat(513) },
        ]) {
            expect(() => validateWatchpointConfig(candidate)).to.throw();
        }
    });

    it('sorts snapshots by ID and rejects duplicate IDs', () => {
        const list = decodeWatchpointList([{ id: 2, ...base }, { id: 1, ...base }]);
        expect(list.map(entry => entry.id)).to.deep.equal([1, 2]);
        expect(() => decodeWatchpointList([{ id: 1, ...base }, { id: 1, ...base }])).to.throw('Duplicate');
    });
});