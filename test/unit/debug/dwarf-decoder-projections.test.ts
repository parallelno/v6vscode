import * as assert from 'assert';
import * as fs from 'fs';
import { fixturePath } from '../../helpers/fixture-paths';
import { parseElf32 } from '../../../src/debug/metadata/elf32-reader';
import { DwarfReader, DW_FORM, DW_AT, numberAttribute } from '../../../src/debug/metadata/dwarf-reader';
import { DwarfStrings } from '../../../src/debug/metadata/dwarf-strings';
import { parseDwarf4CompilationUnits, parseDwarf4VariableDeclarations } from '../../../src/debug/metadata/dwarf4-info-reader';

function reader(body: number[], attrs: number[], prefix = Buffer.alloc(0)) {
    const abbrev = Buffer.from([1, 0x11, 0, ...attrs, 0, 0, 0]);
    const header = Buffer.alloc(11); header.writeUInt32LE(7 + body.length, 0); header.writeUInt16LE(4, 4); header[10] = 2;
    const info = Buffer.concat([prefix, header, Buffer.from(body)]);
    return new DwarfReader(info, abbrev, new DwarfStrings(Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)), Buffer.alloc(0));
}

describe('Unified DIE decoding and versioned baseline projections', () => {
    it('decodes fixed-width section offsets and indirect forms without losing the next attribute', () => {
        const unit = reader([1, 0x79, 7, 0, 0, DW_FORM.data2, 0x34, 0x12, 9],
            [DW_AT.stmt_list, DW_FORM.sec_offset, DW_AT.const_value, DW_FORM.indirect, DW_AT.decl_line, DW_FORM.data1]).readUnits()[0];
        assert.strictEqual(numberAttribute(unit.root!, DW_AT.stmt_list), 0x779);
        assert.strictEqual(numberAttribute(unit.root!, DW_AT.const_value), 0x1234);
        assert.strictEqual(numberAttribute(unit.root!, DW_AT.decl_line), 9);
    });

    it('applies CU-relative reference offsets in later units', () => {
        const first = Buffer.alloc(12); first.writeUInt32LE(8); first.writeUInt16LE(4, 4); first[10] = 2; first[11] = 0;
        const second = reader([1, 3], [DW_AT.type, DW_FORM.ref_udata], first).readUnits()[1];
        assert.strictEqual(numberAttribute(second.root!, DW_AT.type), first.length + 3);
    });

    it('keeps root-only baseline projection independent of unsupported semantic children', () => {
        const abbrev = Buffer.from([1, 0x11, 1, DW_AT.stmt_list, DW_FORM.sec_offset, 0, 0,
            2, 0x34, 0, DW_AT.const_value, 0x7f, 0, 0, 0]);
        const header = Buffer.alloc(11); header.writeUInt32LE(14); header.writeUInt16LE(4, 4); header[10] = 2;
        const info = Buffer.concat([header, Buffer.from([1, 0x79, 7, 0, 0, 2, 0])]);
        assert.deepStrictEqual(parseDwarf4CompilationUnits(info, abbrev, Buffer.alloc(0)), [{ compDir: '', stmtList: 0x779 }]);
        assert.throws(() => parseDwarf4VariableDeclarations(info, abbrev, Buffer.alloc(0), () => []), /Unsupported DWARF form/);
    });

    it('rejects attributes crossing their declared unit instead of reading the next unit', () => {
        const malformed = reader([1, 1], [DW_AT.const_value, DW_FORM.data4]);
        assert.throws(() => malformed.readUnits(), /compilation unit boundary/);
    });

    for (const optimization of ['O0', 'O1', 'O2']) {
        it(`retains v5 semantic fixture coverage at ${optimization}`, () => {
            const elf = parseElf32(fs.readFileSync(fixturePath('cdbg', `probe-${optimization}.elf`)));
            const section = (name: string) => elf.sections.find(section => section.name === name)?.data ?? Buffer.alloc(0);
            const units = new DwarfReader(section('.debug_info'), section('.debug_abbrev'),
                new DwarfStrings(section('.debug_str'), section('.debug_line_str'), section('.debug_str_offsets')), section('.debug_addr')).readUnits();
            assert.ok(units.length); assert.strictEqual(units[0].version, 5); assert.ok(units[0].root?.children.length);
        });
    }
});