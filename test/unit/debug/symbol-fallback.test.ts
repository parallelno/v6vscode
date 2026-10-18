import { expect } from 'chai';
import {
    builtinTypeInfo,
    labelTypeInfo,
    substituteKnownSymbols,
    SYMBOL_NAME_PATTERN,
    uniqueSymbolValue,
} from '../../../src/debug/adapter/symbol-fallback';

describe('Symbol expression fallback', () => {
    it('substitutes dotted symbols that resolve to exactly one address', () => {
        const lookup = (name: string) => name === 'char.health' ? 32 : undefined;
        expect(substituteKnownSymbols('char.health', lookup)).to.equal('0x20');
        expect(substituteKnownSymbols('char.health + 2', lookup)).to.equal('0x20 + 2');
    });

    it('leaves typed member expressions and unknown tokens unchanged', () => {
        const lookup = () => undefined;
        expect(substituteKnownSymbols('hero.pos_x', lookup)).to.equal('hero.pos_x');
        expect(substituteKnownSymbols('char_pool[2].health', lookup)).to.equal('char_pool[2].health');
        expect(substituteKnownSymbols('char.unknown_field', lookup)).to.equal('char.unknown_field');
    });

    it('accepts bare and dotted symbol names for the no-frame path', () => {
        expect(SYMBOL_NAME_PATTERN.test('hero')).to.equal(true);
        expect(SYMBOL_NAME_PATTERN.test('char.health')).to.equal(true);
        expect(SYMBOL_NAME_PATTERN.test('0x1234')).to.equal(false);
        expect(SYMBOL_NAME_PATTERN.test('char_pool[2]')).to.equal(false);
        expect(SYMBOL_NAME_PATTERN.test('')).to.equal(false);
    });

    it('classifies absolute constants as values and RAM labels as memory', () => {
        expect(uniqueSymbolValue([{ address: 0x7500, size: 0, absolute: true }]))
            .to.deep.equal({ kind: 'constant', value: 0x7500 });
        expect(uniqueSymbolValue([{ address: 0x2CF, size: 2, absolute: false }]))
            .to.deep.equal({ kind: 'memory', address: 0x2CF, byteSize: 2 });
        expect(uniqueSymbolValue([{ address: 0x300, size: 0, absolute: false }]))
            .to.deep.equal({ kind: 'memory', address: 0x300, byteSize: 1 });
        expect(uniqueSymbolValue([])).to.equal(undefined);
        expect(uniqueSymbolValue([
            { address: 8, size: 1, absolute: true },
            { address: 9, size: 1, absolute: true },
        ])).to.equal(undefined);
    });

    it('provides builtin primitive and pointer cast types', () => {
        expect(builtinTypeInfo('int')).to.deep.include({ kind: 'base', name: 'int', byteSize: 2, signed: true });
        expect(builtinTypeInfo('unsigned char *')).to.deep.include({ kind: 'pointer', byteSize: 2, targetByteSize: 1 });
        expect(builtinTypeInfo('not_a_type')).to.equal(undefined);
    });

    it('builds the display type for live-memory label values', () => {
        expect(labelTypeInfo(2)).to.deep.include({ kind: 'base', name: 'asm', byteSize: 2, signed: false });
    });
});