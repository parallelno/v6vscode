import * as assert from 'assert';
import { CExpressionService, CExpressionContext } from '../../../src/debug/adapter/c-expression-service';
import { DapHandleStore } from '../../../src/debug/adapter/dap-handle-store';
import { scalarValue, format } from '../../../src/debug/adapter/value-format';
import { DwarfTypes, TypeInfo } from '../../../src/debug/metadata/dwarf-types';
import { DwarfReader, DW_FORM, DW_AT, blockAttribute, stringAttribute } from '../../../src/debug/metadata/dwarf-reader';
import { DwarfStrings } from '../../../src/debug/metadata/dwarf-strings';

describe('Stage-one value and identity regressions', () => {
    for (const size of [1, 2, 4]) {
        it(`interprets signed ${size}-byte operands consistently in display, arithmetic, casts and comparisons`, async () => {
            const signed: TypeInfo = { id: 1, kind: 'base', name: 'signed', byteSize: size, signed: true };
            const unsigned: TypeInfo = { ...signed, id: 2, name: 'unsigned', signed: false };
            const alias: TypeInfo = { ...signed, id: 3, kind: 'typedef', name: 'Alias', of: signed };
            const qualified: TypeInfo = { ...signed, id: 4, kind: 'qualified', name: 'const Alias', of: alias };
            const context: CExpressionContext = {
                resolve: name => ({ value: scalarValue(-1, name === 'u' ? unsigned : qualified) }),
                read: async type => scalarValue(-1, type),
                resolveType: name => name === 'signed' ? signed : name === 'unsigned' ? unsigned : undefined,
            };
            const service = new CExpressionService();
            assert.strictEqual(format((await service.evaluateValue('x', context)).value), '-1');
            assert.strictEqual(format((await service.evaluateValue('x - 1', context)).value), '-2');
            for (const expression of ['x < 0', 'x == -1', 'x + 2 == 1', 'x / 2 == 0', 'u > 0', '(signed)u == -1', '(unsigned)x > 0']) {
                assert.strictEqual(format((await service.evaluateValue(expression, context)).value), '1', expression);
            }
        });
    }

    it('applies cast truncation before evaluating the next operation', async () => {
        const byte: TypeInfo = { id: 1, kind: 'base', name: 'byte', byteSize: 1, signed: false };
        const context: CExpressionContext = { resolve: () => undefined, read: async () => ({ availability: 'unreadable' }), resolveType: () => byte };
        assert.strictEqual(format((await new CExpressionService().evaluateValue('(byte)257 == 1', context)).value), '1');
    });

    it('uses signed members and dereferences in arithmetic, not just bare variables', async () => {
        const int: TypeInfo = { id: 1, kind: 'base', name: 'int', byteSize: 2, signed: true };
        const record: TypeInfo = { id: 2, kind: 'structure', name: 'Record', byteSize: 2, signed: false, members: [{ name: 'delta', offset: 0, type: int }] };
        const pointer: TypeInfo = { id: 3, kind: 'pointer', name: 'int *', byteSize: 2, signed: false, of: int };
        const context: CExpressionContext = {
            resolve: name => ({ value: name === 'p' ? scalarValue(0x1000, pointer) : { type: record, address: 0x1000, availability: 'available' } }),
            read: async type => scalarValue(-1, type), resolveType: () => undefined,
        };
        for (const expression of ['record.delta < 0', '*p == -1', 'record.delta + 2 == 1']) {
            assert.strictEqual(format((await new CExpressionService().evaluateValue(expression, context)).value), '1');
        }
    });

    it('takes DWARF integer encoding over misleading source type names', () => {
        const types = new DwarfTypes(new Map([
            [1, { offset: 1, tag: 0x24, hasChildren: false, children: [], attributes: [
                { name: DW_AT.name, form: 8, value: 'unsigned misleading' },
                { name: DW_AT.byte_size, form: 0x0B, value: 2 },
                { name: DW_AT.encoding, form: 0x0B, value: 5 },
            ] }],
            [2, { offset: 2, tag: 0x24, hasChildren: false, children: [], attributes: [
                { name: DW_AT.name, form: 8, value: 'int' },
                { name: DW_AT.byte_size, form: 0x0B, value: 2 },
                { name: DW_AT.encoding, form: 0x0B, value: 7 },
            ] }],
        ]));
        assert.strictEqual(types.resolve(1)!.signed, true);
        assert.strictEqual(types.resolve(2)!.signed, false);
        assert.strictEqual(format(scalarValue(0xFFFF, types.resolve(1))), '-1');
        assert.strictEqual(format(scalarValue(0xFFFF, types.resolve(2))), '65535');
    });

    it('preserves computed high words and rejects unsupported scalar widths explicitly', async () => {
        const context: CExpressionContext = { resolve: () => undefined, read: async () => ({ availability: 'unreadable' }), resolveType: () => undefined };
        const service = new CExpressionService();
        assert.strictEqual(format((await service.evaluateValue('70000 + 2', context)).value), '70002');
        await assert.rejects(() => service.evaluateValue('4294967296', context), /32-bit range/);
    });

    it('formats unsigned enumerators without sign-extending them', () => {
        const type: TypeInfo = { id: 1, kind: 'enum', name: 'Flags', byteSize: 2, signed: false, enumerators: new Map([['all', 65535]]) };
        assert.strictEqual(format(scalarValue(65535, type)), 'all (65535)');
    });

    it('does not alias a delayed variablesReference to a newer stop or after clear', () => {
        const handles = new DapHandleStore<string>();
        const old = handles.create(1, 'old pool');
        handles.reset(2);
        const next = handles.create(2, 'new parameters');
        assert.notStrictEqual(old, next);
        assert.strictEqual(handles.get(2, old), undefined);
        handles.clear();
        const third = handles.create(3, 'new scope');
        assert.notStrictEqual(third, old);
        assert.notStrictEqual(third, next);
    });

    it('keeps explicit frame IDs and allocated handles in distinct non-reused slots', () => {
        const handles = new DapHandleStore<string>();
        handles.set(1, 1001, 'frame');
        assert.ok(handles.create(1, 'allocated') > 1001);
        handles.reset(2);
        assert.throws(() => handles.set(2, 1001, 'different frame'), /reuse/i);
    });
});

describe('DWARF block and block1 wire forms', () => {
    for (const [form, size] of [[0x09, 130], [0x0A, 3]]) {
        it(`decodes form 0x${form.toString(16)} and advances to the following attribute`, () => {
            const payload = Buffer.alloc(size, 0x31);
            const length = form === 0x09 ? Buffer.from([0x82, 0x01]) : Buffer.from([size]);
            const body = Buffer.concat([Buffer.from([1]), length, payload, Buffer.from('next\0')]);
            const info = Buffer.alloc(11 + body.length);
            info.writeUInt32LE(info.length - 4);
            info.writeUInt16LE(4, 4);
            info[10] = 2;
            body.copy(info, 11);
            const abbrev = Buffer.from([1, 0x11, 0, DW_AT.location, form, DW_AT.name, 0x08, 0, 0, 0]);
            const reader = new DwarfReader(info, abbrev, new DwarfStrings(Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)), Buffer.alloc(0));
            const root = reader.readUnits()[0].root!;
            assert.deepStrictEqual(blockAttribute(root, DW_AT.location), payload);
            assert.strictEqual(stringAttribute(root, DW_AT.name), 'next');
        });
    }

    it('keeps the standard wire codes distinct', () => {
        assert.strictEqual(DW_FORM.block, 0x09);
        assert.strictEqual(DW_FORM.block1, 0x0A);
    });
});
