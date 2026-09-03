import * as assert from 'assert';
import { CExpressionContext, CExpressionService, ExpressionValue } from '../../../src/debug/adapter/c-expression-service';
import { TypeInfo } from '../../../src/debug/metadata/dwarf-types';

describe('CExpressionService', () => {
    const service = new CExpressionService();
    const resolve = (name: string) => ({ count: 3, mask: 0xF0, zero: 0 })[name];

    it('applies C scalar precedence and short-circuits logical operators', async () => {
        assert.strictEqual(await service.evaluate('count + 2 * 4 << 1', resolve), 22);
        assert.strictEqual(await service.evaluate("'A' == 65 && (mask & 0x0F) == 0", resolve), 1);
        assert.strictEqual(await service.evaluate('1 || unknown', resolve), 1);
        assert.strictEqual(await service.evaluate('zero && unknown', resolve), 0);
    });

    it('supports unary, arithmetic, shifts, bitwise, comparison, and logical operators', async () => {
        assert.strictEqual(await service.evaluate('~0 & 0xFF', resolve), 255);
        assert.strictEqual(await service.evaluate('-(count - 5) >> 1', resolve), 1);
        assert.strictEqual(await service.evaluate('count >= 3 && count != 4', resolve), 1);
        assert.strictEqual(await service.evaluate('count % 2', resolve), 1);
    });

    it('binds each identifier through the supplied resolver', async () => {
        const names: string[] = [];
        const value = await service.evaluate('outer + inner', name => {
            names.push(name);
            return name === 'outer' ? 2 : name === 'inner' ? 5 : undefined;
        });

        assert.strictEqual(value, 7);
        assert.deepStrictEqual(names, ['outer', 'inner']);
    });

    it('evaluates addressable values with dereference, indexing, members, and casts', async () => {
        const int: TypeInfo = { id: 1, kind: 'base', name: 'int', byteSize: 2, signed: true };
        const intPointer: TypeInfo = { id: 2, kind: 'pointer', name: 'int *', byteSize: 2, signed: false, of: int };
        const pair: TypeInfo = { id: 3, kind: 'structure', name: 'Pair', byteSize: 4, signed: false, members: [{ name: 'left', offset: 0, type: int }, { name: 'right', offset: 2, type: int }] };
        const pairPointer: TypeInfo = { id: 4, kind: 'pointer', name: 'Pair *', byteSize: 2, signed: false, of: pair };
        const array: TypeInfo = { id: 5, kind: 'array', name: 'int[2]', byteSize: 4, signed: false, of: int, count: 2 };
        const bytes = new Map([[0x1000, 7], [0x1001, 0], [0x1002, 9], [0x1003, 0], [0x1010, 4], [0x1011, 0], [0x1012, 6], [0x1013, 0]]);
        const values: Record<string, ExpressionValue> = {
            item: { value: { type: int, address: 0x1000, bytes: new Uint8Array([7, 0]), availability: 'available' } },
            pointer: { value: { type: intPointer, bytes: new Uint8Array([0x10, 0x10]), availability: 'available' } },
            items: { value: { type: array, address: 0x1000, availability: 'available' } },
            pair: { value: { type: pair, address: 0x1010, availability: 'available' } },
            pairPointer: { value: { type: pairPointer, bytes: new Uint8Array([0x10, 0x10]), availability: 'available' } },
        };
        const context: CExpressionContext = {
            resolve: name => values[name],
            read: async (type, address) => {
                const values = Array.from({ length: type.byteSize }, (_, index) => bytes.get(address + index));
                return values.some(value => value === undefined) ? { type, address, availability: 'unreadable' } : { type, address, bytes: new Uint8Array(values as number[]), availability: 'available' };
            },
            resolveType: name => ({ int, 'int *': intPointer, Pair: pair, 'Pair *': pairPointer })[name],
        };

        assert.strictEqual((await service.evaluateValue('*pointer', context)).value.bytes?.[0], 4);
        assert.strictEqual((await service.evaluateValue('&item', context)).value.bytes?.[0], 0);
        assert.strictEqual((await service.evaluateValue('items[1]', context)).value.bytes?.[0], 9);
        assert.strictEqual((await service.evaluateValue('pair.right', context)).value.bytes?.[0], 6);
        assert.strictEqual((await service.evaluateValue('pairPointer->left', context)).value.bytes?.[0], 4);
        assert.strictEqual((await service.evaluateValue('(int *) 0x1000', context)).value.type?.name, 'int *');
    });

    it('reports an unreadable dereference without executing target code', async () => {
        const int: TypeInfo = { id: 1, kind: 'base', name: 'int', byteSize: 2, signed: true };
        const pointer: TypeInfo = { id: 2, kind: 'pointer', name: 'int *', byteSize: 2, signed: false, of: int };
        const context: CExpressionContext = {
            resolve: () => ({ value: { type: pointer, bytes: new Uint8Array([0xFF, 0xFF]), availability: 'available' } }),
            read: async () => ({ availability: 'unreadable' }),
            resolveType: () => undefined,
        };
        await assert.rejects(() => service.evaluateValue('*pointer', context), /Pointer 0xFFFF is outside readable memory/);
    });

    it('rejects calls, assignments, malformed literals, and excessive nesting', async () => {
        await assert.rejects(() => service.evaluate('function()', resolve), /Unexpected token/);
        await assert.rejects(() => service.evaluate('count = 1', resolve), /Unexpected character/);
        await assert.rejects(() => service.evaluate('0x', resolve), /Expected hexadecimal digits/);
        await assert.rejects(() => service.evaluate(`${'('.repeat(65)}1${')'.repeat(65)}`, resolve), /nesting is too deep/);
    });
});