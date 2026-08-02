import { expect } from 'chai';
import { IndexedSymbol } from '../../../src/debug/metadata/debug-symbol-service';
import { filterSymbols } from '../../../src/debug/views/symbols-query';

const symbols: IndexedSymbol[] = [
    { id: '1:0', name: 'Alpha', address: 0x0100, size: 4, type: 2, binding: 1 },
    { id: '1:1', name: 'alpha_tail', address: 0x0110, size: 1, type: 1, binding: 0 },
    { id: '1:2', name: 'value.$', address: 0x0120, size: 1, type: 1, binding: 0 },
    { id: '1:3', name: 'alias', address: 0x0100, size: 1, type: 1, binding: 0 },
];

describe('Symbols query filtering', () => {
    it('returns every symbol for an empty query', () => {
        expect(filterSymbols(symbols, '  ', { matchCase: false, wholeWord: false }).matches).to.equal(symbols);
    });

    it('applies case and whole-name matching independently', () => {
        expect(names('ALPHA', false, false)).to.deep.equal(['Alpha', 'alpha_tail']);
        expect(names('pha', true, false)).to.deep.equal(['Alpha', 'alpha_tail']);
        expect(names('alpha', false, true)).to.deep.equal(['Alpha']);
        expect(names('alpha', true, true)).to.deep.equal([]);
        expect(names('value.$', true, true)).to.deep.equal(['value.$']);
    });

    it('unions expression-value and name matches without losing aliases', () => {
        expect(names('Alpha', true, true)).to.deep.equal(['Alpha', 'alias']);
        expect(names('0x100', false, false)).to.deep.equal(['Alpha', 'alias']);
        expect(names('Alpha+0x10', false, false)).to.deep.equal(['alpha_tail']);
    });

    it('keeps valid text matching when expression evaluation fails', () => {
        const result = filterSymbols(symbols, 'tail', { matchCase: false, wholeWord: false });
        expect(result.matches.map(symbol => symbol.name)).to.deep.equal(['alpha_tail']);
        expect(result.expressionError).to.equal(undefined);
    });

    it('reports malformed expression-shaped queries with no name match', () => {
        const result = filterSymbols(symbols, 'Alpha+', { matchCase: false, wholeWord: false });
        expect(result.matches).to.deep.equal([]);
        expect(result.expressionError).to.be.a('string').and.not.empty;
    });
});

function names(query: string, matchCase: boolean, wholeWord: boolean): string[] {
    return filterSymbols(symbols, query, { matchCase, wholeWord }).matches.map(symbol => symbol.name);
}