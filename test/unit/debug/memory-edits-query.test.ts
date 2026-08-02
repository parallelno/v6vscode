import { expect } from 'chai';
import { parseMemoryEditQuery } from '../../../src/debug/views/memory-edits-query';

describe('Memory Edits query parser', () => {
    it('parses decimal and all supported hexadecimal byte forms', () => {
        for (const input of ['42', '$2A', '0x2A', '2Ah']) {
            expect(parseMemoryEditQuery(input)).to.deep.equal({ kind: 'value', value: 42 });
        }
        expect(parseMemoryEditQuery('  ')).to.deep.equal({ kind: 'empty' });
    });

    it('rejects malformed and out-of-range values', () => {
        for (const input of ['-1', '1.5', '0xGG', '256', '$100']) {
            expect(parseMemoryEditQuery(input).kind).to.equal('invalid');
        }
    });
});