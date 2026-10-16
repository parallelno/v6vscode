import { expect } from 'chai';
import * as path from 'path';
import { parseDwarf4CompilationDirectories, parseDwarf4CompilationUnits } from '../../../src/debug/metadata/dwarf4-info-reader';
import { parseDwarf4LineFiles, parseDwarf4LineSection } from '../../../src/debug/metadata/dwarf4-line-reader';

/** Build a minimal DWARF v4 line program with one directory, one file and one row. */
function makeV4LineProgram(dirs: string[], files: Array<{ name: string; dir: number }>, address: number): Buffer {
    const prologue: number[] = [
        1, 1, 1, 0xFB, 0x0E, 13,          // min_inst, max_ops, default_is_stmt, line_base, line_range, opcode_base
        0, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, // standard opcode lengths (12)
    ];
    for (const dir of dirs) {
        prologue.push(...Buffer.from(dir, 'ascii'), 0);
    }
    prologue.push(0); // include_directories terminator
    for (const file of files) {
        prologue.push(...Buffer.from(file.name, 'ascii'), 0);
        prologue.push(file.dir, 0, 0);    // directory index, mtime, length
    }
    prologue.push(0); // file_names terminator
    const program: number[] = [
        0x00, 0x03, 0x02, address & 0xFF, (address >> 8) & 0xFF, // DW_LNE_set_address
        0x01,                                                     // DW_LNS_copy
        0x00, 0x01, 0x01,                                         // DW_LNE_end_sequence
    ];
    const headerLength = prologue.length;
    const unitLength = 2 + 4 + headerLength + program.length;
    const unit: number[] = [];
    unit.push(unitLength & 0xFF, (unitLength >> 8) & 0xFF, (unitLength >> 16) & 0xFF, (unitLength >> 24) & 0xFF);
    unit.push(0x04, 0x00); // version 4
    unit.push(headerLength & 0xFF, (headerLength >> 8) & 0xFF, (headerLength >> 16) & 0xFF, (headerLength >> 24) & 0xFF);
    unit.push(...prologue, ...program);
    return Buffer.from(unit);
}

describe('parseDwarf4CompilationUnits', () => {
    it('returns comp_dir and stmt_list for every compilation unit', () => {
        const abbrev = Buffer.from([
            0x01, 0x11, 0x00,   // code, DW_TAG_compile_unit, no children
            0x1B, 0x0E,         // DW_AT_comp_dir, DW_FORM_strp
            0x10, 0x17,         // DW_AT_stmt_list, DW_FORM_sec_offset
            0x00, 0x00,         // attribute terminator
            0x00,               // abbreviation table terminator
        ]);
        const strings = Buffer.from('C:/site/samples/09_x\0C:/site/engine\0');
        const unit = (stringOffset: number, stmtList: number): number[] => [
            0x10, 0x00, 0x00, 0x00, // unit length (16)
            0x04, 0x00,             // version 4
            0x00, 0x00, 0x00, 0x00, // abbreviation offset
            0x02,                   // address size
            0x01,                   // abbreviation code
            stringOffset & 0xFF, (stringOffset >> 8) & 0xFF, 0x00, 0x00,
            stmtList & 0xFF, (stmtList >> 8) & 0xFF, (stmtList >> 16) & 0xFF, (stmtList >> 24) & 0xFF,
        ];
        const info = Buffer.from([...unit(0, 0), ...unit(21, 0x779)]);

        expect(parseDwarf4CompilationUnits(info, abbrev, strings)).to.deep.equal([
            { compDir: 'C:/site/samples/09_x', stmtList: 0 },
            { compDir: 'C:/site/engine', stmtList: 0x779 },
        ]);
        expect(parseDwarf4CompilationDirectories(info, abbrev, strings)).to.deep.equal([
            'C:/site/samples/09_x',
            'C:/site/engine',
        ]);
    });
});

describe('per-line-program compilation directories', () => {
    const programA = makeV4LineProgram(
        ['../../engine/common'],
        [{ name: 'v6_consts.asm', dir: 1 }],
        0x100,
    );
    const programB = makeV4LineProgram(
        ['gfx'],
        [{ name: 'v6_sprite_draw.asm', dir: 1 }],
        0x200,
    );
    const section = Buffer.concat([programA, programB]);
    const debugStrings = Buffer.alloc(0);
    const lineStrings = Buffer.alloc(0);
    const filesByAddress = (rows: Array<{ address: number; file: string }>) =>
        new Map(rows.map(row => [row.address, row.file]));

    it('resolves each program against its own comp_dir via the stmt_list map', () => {
        const compDirs = new Map<number, string>([
            [0, 'C:/site/samples/09_x'],
            [programA.length, 'C:/site/engine'],
        ]);
        const rows = parseDwarf4LineSection(section, 2, '', debugStrings, lineStrings, compDirs);
        const byAddress = filesByAddress(rows);
        expect(byAddress.get(0x100)).to.equal(path.normalize('C:/site/engine/common/v6_consts.asm'));
        expect(byAddress.get(0x200)).to.equal(path.normalize('C:/site/engine/gfx/v6_sprite_draw.asm'));
    });

    it('resolves each program against its own comp_dir via program order', () => {
        const compDirs = ['C:/site/samples/09_x', 'C:/site/engine'];
        const rows = parseDwarf4LineSection(section, 2, '', debugStrings, lineStrings, compDirs);
        const byAddress = filesByAddress(rows);
        expect(byAddress.get(0x100)).to.equal(path.normalize('C:/site/engine/common/v6_consts.asm'));
        expect(byAddress.get(0x200)).to.equal(path.normalize('C:/site/engine/gfx/v6_sprite_draw.asm'));
    });

    it('falls back to the shared comp_dir for programs without an entry', () => {
        const compDirs: Array<string | undefined> = [undefined, 'C:/site/engine'];
        const rows = parseDwarf4LineSection(section, 2, '', debugStrings, lineStrings, compDirs);
        const byAddress = filesByAddress(rows);
        expect(byAddress.get(0x100)).to.equal('../../engine/common/v6_consts.asm');
        expect(byAddress.get(0x200)).to.equal(path.normalize('C:/site/engine/gfx/v6_sprite_draw.asm'));
    });

    it('keeps relative file paths when no per-program directories are given', () => {
        const rows = parseDwarf4LineSection(section, 2);
        const byAddress = filesByAddress(rows);
        expect(byAddress.get(0x100)).to.equal('../../engine/common/v6_consts.asm');
        expect(byAddress.get(0x200)).to.equal('gfx/v6_sprite_draw.asm');
    });

    it('resolves the file table of parseDwarf4LineFiles per program', () => {
        const compDirs = new Map<number, string>([
            [0, 'C:/site/samples/09_x'],
            [programA.length, 'C:/site/engine'],
        ]);
        const files = parseDwarf4LineFiles(section, '', debugStrings, lineStrings, compDirs);
        expect(files).to.deep.equal([
            path.normalize('C:/site/engine/common/v6_consts.asm'),
            path.normalize('C:/site/engine/gfx/v6_sprite_draw.asm'),
        ]);
    });
});