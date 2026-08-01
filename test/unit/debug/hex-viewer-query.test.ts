import { expect } from 'chai';
import { parseHexQuery } from '../../../src/debug/views/hex-viewer-query';

describe('Hex Viewer query parser', () => {
    it('parses decimal and all supported hexadecimal forms', () => {
        for (const [query, value] of [
            ['256', 0x0100], ['0x100', 0x0100], ['100h', 0x0100], ['$100', 0x0100],
            ['65535', 0xFFFF], ['0xFFFF', 0xFFFF],
        ] as Array<[string, number]>) {
            expect(parseHexQuery(query)).to.deep.equal({
                kind: 'location',
                location: { kind: 'address', value },
            });
        }
    });

    it('parses symbols and inclusive range endpoints without deriving a read length', () => {
        expect(parseHexQuery('main')).to.deep.equal({
            kind: 'location', location: { kind: 'symbol', name: 'main' },
        });
        expect(parseHexQuery('$100 .. buffer_end')).to.deep.equal({
            kind: 'range',
            start: { kind: 'address', value: 0x100 },
            end: { kind: 'symbol', name: 'buffer_end' },
        });
        expect(parseHexQuery('11-14')).to.deep.equal({
            kind: 'range',
            start: { kind: 'address', value: 11 },
            end: { kind: 'address', value: 14 },
        });
    });

    it('rejects incomplete, overflowing, reversed, and multiply delimited ranges', () => {
        for (const query of ['', '$100..', '0x10000', '$200..$100', '$1..$2..$3']) {
            const result = parseHexQuery(query);
            if (query === '') {
                expect(result).to.deep.equal({ kind: 'empty' });
            } else {
                expect(result.kind).to.equal('invalid');
            }
        }
    });
});