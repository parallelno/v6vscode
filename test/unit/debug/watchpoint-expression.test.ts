import { expect } from 'chai';
import { evaluateSymbolExpression } from '../../../src/debug/utilities/symbol-expression';

describe('watchpoint address expressions', () => {
    const symbols = new Map<string, number>([
        ['set_palette', 0x1000],
        ['other_symbol', 0x20],
    ]);
    const resolve = (name: string): number => {
        const value = symbols.get(name);
        if (value === undefined) { throw new Error(`Symbol not found: ${name}`); }
        return value;
    };

    it('evaluates symbols, literals, multiplication, and addition with precedence', () => {
        expect(evaluateSymbolExpression('set_palette+1', resolve)).to.equal(0x1001);
        expect(evaluateSymbolExpression('set_palette+0x10*3', resolve)).to.equal(0x1030);
        expect(evaluateSymbolExpression('set_palette+other_symbol', resolve)).to.equal(0x1020);
        expect(evaluateSymbolExpression('(set_palette+$10)*2', resolve)).to.equal(0x2020);
        expect(evaluateSymbolExpression('100h + 2', resolve)).to.equal(0x102);
        expect(evaluateSymbolExpression('set_palette - -other_symbol', resolve)).to.equal(0x1020);
    });

    it('rejects missing symbols, malformed expressions, and unsafe arithmetic', () => {
        expect(() => evaluateSymbolExpression('missing+1', resolve)).to.throw('Symbol not found: missing');
        expect(() => evaluateSymbolExpression('set_palette/', resolve)).to.throw('Unexpected token');
        expect(() => evaluateSymbolExpression('(set_palette+1', resolve)).to.throw("Expected ')'");
        expect(() => evaluateSymbolExpression('9007199254740991*2', resolve)).to.throw('safe integer range');
        expect(() => evaluateSymbolExpression('duplicate', () => {
            throw new Error('Symbol is ambiguous: duplicate');
        })).to.throw('Symbol is ambiguous: duplicate');
    });
});