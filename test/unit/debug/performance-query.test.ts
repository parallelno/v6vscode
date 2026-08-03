import { expect } from 'chai';
import {
    filterPerformanceEntries,
    normalizePerformanceQuery,
} from '../../../src/debug/views/performance-query';

describe('Performance query', () => {
    const entries = [
        { id: 1, name: 'Main Frame', addrStart: 1, addrEnd: 2, active: true, averageClockCycles: 3, testCount: 4 },
        { id: 2, name: 'Draw Sprites', addrStart: 3, addrEnd: 4, active: false, averageClockCycles: 5, testCount: 6 },
    ];

    it('filters names by case-insensitive substring', () => {
        expect(filterPerformanceEntries(entries, 'FRAME').map(entry => entry.id)).to.deep.equal([1]);
        expect(filterPerformanceEntries(entries, 'sprites').map(entry => entry.id)).to.deep.equal([2]);
        expect(filterPerformanceEntries(entries, '  ').map(entry => entry.id)).to.deep.equal([1, 2]);
    });

    it('bounds persisted query text', () => {
        expect(normalizePerformanceQuery('x'.repeat(300))).to.have.length(256);
    });
});