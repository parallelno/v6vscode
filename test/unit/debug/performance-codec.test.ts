import { expect } from 'chai';
import {
    decodeCodePerfSnapshots,
    validateCodePerfInput,
} from '../../../src/debug/performance/performance-codec';

describe('Performance codec', () => {
    const input = { name: 'frame', addrStart: 0x100, addrEnd: 0x120, active: true };
    const snapshot = { ...input, id: 1, averageClockCycles: 12.5, testCount: 3 };

    it('accepts valid inputs and authoritative snapshots', () => {
        expect(validateCodePerfInput(input)).to.deep.equal(input);
        expect(decodeCodePerfSnapshots([snapshot])).to.deep.equal([snapshot]);
    });

    it('rejects malformed, duplicate, and unordered snapshots', () => {
        expect(() => decodeCodePerfSnapshots({ entries: [snapshot] })).to.throw('must be an array');
        expect(() => decodeCodePerfSnapshots([{ ...snapshot, testCount: -1 }])).to.throw('testCount');
        expect(() => decodeCodePerfSnapshots([snapshot, snapshot])).to.throw('ordered by unique ID');
        expect(() => decodeCodePerfSnapshots([{ ...snapshot, id: 2 }, snapshot])).to.throw('ordered by unique ID');
        expect(() => decodeCodePerfSnapshots([{ ...snapshot, extra: true }])).to.throw('Unknown CodePerf snapshot field');
    });

    it('enforces address, endpoint, and UTF-8 name limits', () => {
        const limits = { addressExclusive: 4, maxNameBytes: 3, maxRecords: 2, maxTestCount: 5 };
        expect(() => validateCodePerfInput({ ...input, addrStart: 4 }, limits)).to.throw('addrStart');
        expect(() => validateCodePerfInput({ ...input, addrStart: 2, addrEnd: 2 }, limits)).to.throw('greater');
        expect(() => validateCodePerfInput({ ...input, addrStart: 1, addrEnd: 2, name: 'éé' }, limits))
            .to.throw('UTF-8 bytes');
        expect(() => validateCodePerfInput({ ...input, statistics: 1 }, limits))
            .to.throw('Unknown CodePerf input field');
    });
});