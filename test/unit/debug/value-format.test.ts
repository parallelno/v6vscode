import * as assert from 'assert';
import { TypeInfo } from '../../../src/debug/metadata/dwarf-types';
import { dapVariableValue, format, scalarValue } from '../../../src/debug/adapter/value-format';
import { VariableService } from '../../../src/debug/adapter/variable-service';

const byte: TypeInfo = { id: 1, kind: 'base', name: 'byte', byteSize: 1, signed: false };
const word: TypeInfo = { id: 2, kind: 'base', name: 'word', byteSize: 2, signed: false };
const alias: TypeInfo = { id: 3, kind: 'typedef', name: 'Word', byteSize: 2, signed: false, of: word };
const qualified: TypeInfo = { id: 4, kind: 'qualified', name: 'const Word', byteSize: 2, signed: false, of: alias };
const record: TypeInfo = {
    id: 5, kind: 'structure', name: 'Record', byteSize: 3, signed: false,
    members: [{ name: 'health', offset: 0, type: byte }, { name: 'ptr', offset: 1, type: qualified }],
};

describe('Shared typed value presentation', () => {
    it('respects byte and word widths, including typedef and qualifier wrappers', () => {
        assert.strictEqual(format(scalarValue(0xFFFF, byte)), '255');
        for (const type of [word, alias, qualified]) {
            assert.strictEqual(format(scalarValue(0xFFFF, type)), '65535');
            assert.strictEqual(format(scalarValue(0x00FF, type)), '255');
        }
    });

    it('uses the same word formatting in struct summaries, expanded fields, and pool rows', async () => {
        const service = new VariableService();
        const context = { memory: { readBytes: async (address: number, size: number) =>
            new Uint8Array([100, 255, 255].slice(address - 0x1000, address - 0x1000 + size)) } } as any;
        const value = await service.readAt(context, record, 0x1000);
        const fields = await service.children(context, value);
        const pool: TypeInfo = { id: 6, kind: 'array', name: 'Record[]', byteSize: 3, signed: false, of: record, count: 1 };
        const elements = await service.children(context, { type: pool, address: 0x1000, availability: 'available' });

        assert.strictEqual(format(value), '0x1000 {health = 100, ptr = 65535}');
        assert.strictEqual(fields[1].value, '65535');
        assert.strictEqual(fields[1].type, 'const Word');
        assert.strictEqual(elements[0].value, format(value));
        assert.deepStrictEqual(elements[0], dapVariableValue(value, '[0]'));
    });

    it('formats aliased pointers, booleans and signed values by their concrete types', () => {
        const pointer: TypeInfo = { id: 7, kind: 'pointer', name: 'word *', byteSize: 2, signed: false, of: word };
        const pointerAlias: TypeInfo = { ...alias, name: 'Handle', of: pointer };
        assert.strictEqual(format(scalarValue(0x1234, pointerAlias)), '0x1234');
        assert.strictEqual(format(scalarValue(0, pointerAlias)), 'NULL');
        assert.strictEqual(format(scalarValue(0xFFFF, { ...word, signed: true })), '-1');
        assert.strictEqual(format(scalarValue(1, { ...byte, name: 'bool' })), 'true');
    });

    it('reports a partial word read as unavailable instead of silently displaying a byte', async () => {
        const service = new VariableService();
        const context = { memory: { readBytes: async () => new Uint8Array([255]) } } as any;
        assert.strictEqual(format(await service.readAt(context, word, 0x1000)), '<memory unavailable>');
        assert.strictEqual(format({ type: record, address: 0x1000, bytes: new Uint8Array([100, 255]), availability: 'available' }),
            '0x1000 {health = 100, ptr = <memory unavailable>}');
        assert.strictEqual(format(await service.readAt(context, word, 0xFFFF)), '<memory unavailable>');
    });
});
