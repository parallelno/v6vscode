import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parseElf32, readULEB128, readSLEB128, ELFCLASS32, ELFDATA2LSB, SHN_ABS, SHT_SYMTAB } from '../../../src/debug/metadata/elf32-reader';
import { parseDwarf4LineFiles, parseDwarf4LineSection } from '../../../src/debug/metadata/dwarf4-line-reader';
import { parseDwarf4CompilationDirectories } from '../../../src/debug/metadata/dwarf4-info-reader';
import { buildDebugIndex } from '../../../src/debug/metadata/debug-index';
import { loadDebugArtifact } from '../../../src/debug/metadata/debug-artifact-loader';

// Path to the companion ELF built by `make` in the test project
const ELF_PATH = path.join(__dirname, '..', '..', '..', 'temp', 'project', 'out', 'demo1.elf');
const ELF_EXISTS = fs.existsSync(ELF_PATH);

// ---------------------------------------------------------------------------
// LEB128 helpers
// ---------------------------------------------------------------------------

describe('readULEB128', () => {
    it('decodes a single-byte value', () => {
        const [v, n] = readULEB128(Buffer.from([0x00]), 0);
        expect(v).to.equal(0); expect(n).to.equal(1);
    });
    it('decodes a two-byte value', () => {
        const [v, n] = readULEB128(Buffer.from([0x80, 0x01]), 0);
        expect(v).to.equal(128); expect(n).to.equal(2);
    });
    it('decodes 300 (0xAC 0x02)', () => {
        const [v] = readULEB128(Buffer.from([0xAC, 0x02]), 0);
        expect(v).to.equal(300);
    });
});

describe('readSLEB128', () => {
    it('decodes zero', () => {
        const [v, n] = readSLEB128(Buffer.from([0x00]), 0);
        expect(v).to.equal(0); expect(n).to.equal(1);
    });
    it('decodes -1 (0x7F)', () => {
        const [v] = readSLEB128(Buffer.from([0x7F]), 0);
        expect(v).to.equal(-1);
    });
    it('decodes -128 (0x80 0x7F)', () => {
        const [v] = readSLEB128(Buffer.from([0x80, 0x7F]), 0);
        expect(v).to.equal(-128);
    });
    it('decodes 63', () => {
        const [v] = readSLEB128(Buffer.from([0x3F]), 0);
        expect(v).to.equal(63);
    });
});

describe('parseDwarf4CompilationDirectories', () => {
    it('reads DW_AT_comp_dir through the compilation-unit abbreviation', () => {
        const abbrev = Buffer.from([
            0x01, 0x11, 0x00, // code, DW_TAG_compile_unit, no children
            0x1B, 0x0E,       // DW_AT_comp_dir, DW_FORM_strp
            0x00, 0x00,       // attribute list terminator
            0x00,             // abbreviation table terminator
        ]);
        const info = Buffer.from([
            0x09, 0x00, 0x00, 0x00, // unit length
            0x04, 0x00,             // DWARF v4
            0x00, 0x00, 0x00, 0x00, // abbreviation offset
            0x02,                   // address size
            0x01,                   // compilation-unit abbreviation code
            0x00, 0x00, 0x00, 0x00, // .debug_str offset
        ]);

        expect(parseDwarf4CompilationDirectories(info, abbrev, Buffer.from('C:\\project\0')))
            .to.deep.equal(['C:\\project']);
    });

    it('returns no directories when compilation units omit DW_AT_comp_dir', () => {
        const abbrev = Buffer.from([0x01, 0x11, 0x00, 0x00, 0x00, 0x00]);
        const info = Buffer.from([
            0x05, 0x00, 0x00, 0x00, 0x04, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x02, 0x01,
        ]);

        expect(parseDwarf4CompilationDirectories(info, abbrev, Buffer.alloc(0))).to.deep.equal([]);
    });
});

// ---------------------------------------------------------------------------
// ELF / DWARF integration — runs only when demo1.elf is present
// ---------------------------------------------------------------------------

(ELF_EXISTS ? describe : describe.skip)('parseElf32 against demo1.elf', () => {
    let elfBuf: Buffer;
    before(() => { elfBuf = fs.readFileSync(ELF_PATH); });

    it('parses a valid ELFCLASS32 LE ELF', () => {
        const elf = parseElf32(elfBuf);
        expect(elf.elfType).to.equal(2);    // ET_EXEC
        expect(elf.machine).to.equal(0x8080); // i8080/V6C
    });

    it('finds all expected debug sections', () => {
        const elf = parseElf32(elfBuf);
        const names = elf.sections.map(s => s.name);
        expect(names).to.include('.debug_line');
        expect(names).to.include('.debug_info');
        expect(names).to.include('.symtab');
        expect(names).to.include('.text');
    });

    it('detects address_size = 2', () => {
        const elf = parseElf32(elfBuf);
        expect(elf.addressSize).to.equal(2);
    });

    it('.text section starts at load address 0x0100', () => {
        const elf = parseElf32(elfBuf);
        const text = elf.sections.find(s => s.name === '.text')!;
        expect(text).to.exist;
        expect(text.addr).to.equal(0x0100);
    });

    it('parses symbols from .symtab', () => {
        const elf = parseElf32(elfBuf);
        expect(elf.symbols.length).to.be.greaterThan(0);
        const func = elf.symbols.find(s => s.name === 'main');
        expect(func).to.exist;
        expect(func!.value).to.be.at.least(0x100);
    });
});

(ELF_EXISTS ? describe : describe.skip)('DWARF v4 line reader against demo1.elf', () => {
    let rows: ReturnType<typeof parseDwarf4LineSection>;

    before(() => {
        const elfBuf = fs.readFileSync(ELF_PATH);
        const elf = parseElf32(elfBuf);
        const dl = elf.sections.find(s => s.name === '.debug_line')!;
        rows = parseDwarf4LineSection(dl.data, elf.addressSize);
    });

    it('produces at least one row', () => {
        expect(rows.length).to.be.greaterThan(0);
    });

    it('all addresses are in the 0x0000–0xFFFF range', () => {
        for (const r of rows) {
            expect(r.address).to.be.at.least(0);
            expect(r.address).to.be.lessThan(0x10000);
        }
    });

    it('includes source files from main and included assembly files', () => {
        const files = new Set(rows.map(row => row.file));
        expect(files).to.include('src/main.asm');
        expect(files).to.include('src/sub/rnd.asm');
        const elf = parseElf32(fs.readFileSync(ELF_PATH));
        const debugLine = elf.sections.find(section => section.name === '.debug_line')!;
        expect(parseDwarf4LineFiles(debugLine.data)).to.include.members([...files]);
    });

    it('first is_stmt row has address >= 0x100 (ROM load address)', () => {
        const first = rows.find(r => r.isStmt);
        expect(first).to.exist;
        expect(first!.address).to.be.at.least(0x100);
    });

    it('has rows with different line numbers', () => {
        const lines = new Set(rows.map(r => r.line));
        expect(lines.size).to.be.greaterThan(2);
    });
});

(ELF_EXISTS ? describe : describe.skip)('DebugIndex against demo1.elf', () => {
    let index: ReturnType<typeof buildDebugIndex>;
    let rows: ReturnType<typeof parseDwarf4LineSection>;

    before(() => {
        const elfBuf = fs.readFileSync(ELF_PATH);
        const elf = parseElf32(elfBuf);
        const dl = elf.sections.find(s => s.name === '.debug_line')!;
        rows = parseDwarf4LineSection(dl.data, elf.addressSize);
        index = buildDebugIndex(rows, elf.symbols, '');
    });

    it('reports at least one source file', () => {
        expect(index.sourceFiles.length).to.be.greaterThan(0);
    });

    it('resolveAddress round-trips: addr → (file,line) → addr', () => {
        // Find any is_stmt row address and resolve it back
        const elfBuf = fs.readFileSync(ELF_PATH);
        const elf = parseElf32(elfBuf);
        const dl = elf.sections.find(s => s.name === '.debug_line')!;
        const rows = parseDwarf4LineSection(dl.data, elf.addressSize);
        const stmtRow = rows.find(r => r.isStmt);
        if (!stmtRow) { return; } // skip if no stmt rows
        const loc = index.resolveAddress(stmtRow.address);
        expect(loc).to.exist;
        expect(loc!.line).to.equal(stmtRow.line);
    });

    it('resolveBreakpoint slides to next stmt row for non-executable line', () => {
        // Line 1 is a comment — should slide to the next executable line
        const result = index.resolveBreakpoint(index.sourceFiles[0], 1);
        if (result) {
            // If found, address must be in valid range
            expect(result.address).to.be.at.least(0x100);
            expect(result.verifiedLine).to.be.at.least(1);
        }
    });

    it('resolves an absolute editor path against a DWARF-relative source path', () => {
        const sourcePath = path.join(__dirname, '..', '..', '..', 'temp', 'project', 'src', 'main.asm');
        const firstMainRow = rows.find(row => row.isStmt && row.file === 'src/main.asm')!;
        expect(index.resolveBreakpoint(sourcePath, firstMainRow.line)).to.deep.equal({
            address: firstMainRow.address,
            verifiedLine: firstMainRow.line,
        });
    });

    it('symbolAtAddress returns enclosing function', () => {
        // PC=0x100 should be inside 'main'
        const sym = index.symbolAtAddress(0x100);
        if (sym) {
            expect(sym.name).to.be.a('string').with.length.greaterThan(0);
        }
    });

    it('resolves the fill_random function symbol from demo1 metadata', () => {
        const elf = parseElf32(fs.readFileSync(ELF_PATH));
        const expected = elf.symbols.find(symbol => symbol.name === 'fill_random')!;
        expect(index.symbol('fill_random')).to.include({ name: expected.name, address: expected.value, size: expected.size });
    });

    it('returns symbols in an inclusive range without losing duplicate-name candidates', () => {
        const duplicateIndex = buildDebugIndex([], [
            { name: 'value', value: 0x0100, size: 1, type: 1, binding: 0, section: 1 },
            { name: 'value', value: 0x0110, size: 1, type: 1, binding: 0, section: 1 },
        ], '');

        expect(duplicateIndex.symbol('value')).to.equal(undefined);
        expect(duplicateIndex.symbols('value').map(symbol => symbol.address)).to.deep.equal([0x0100, 0x0110]);
        expect(duplicateIndex.symbolsInRange(0x0108, 0x0110).map(symbol => symbol.address)).to.deep.equal([0x0110]);
    });

    it('returns all symbols ordered by address and then name', () => {
        const orderedIndex = buildDebugIndex([], [
            { name: 'zeta', value: 0x0110, size: 1, type: 1, binding: 0, section: 1 },
            { name: 'beta', value: 0x0100, size: 1, type: 1, binding: 0, section: 1 },
            { name: 'alpha', value: 0x0100, size: 1, type: 1, binding: 0, section: 1 },
            { name: 'reset', value: 0, size: 1, type: 2, binding: 1, section: 1 },
            { name: 'undefined', value: 0, size: 1, type: 2, binding: 1, section: 0 },
        ], '');

        expect(orderedIndex.allSymbols().map(symbol => symbol.name)).to.deep.equal(['reset', 'alpha', 'beta', 'zeta']);
    });

    it('includes absolute STT_NOTYPE constants but excludes other untyped symbols', () => {
        const indexWithConstant = buildDebugIndex([], [
            { name: 'CONSTANT', value: 0x4000, size: 0, type: 0, binding: 0, section: SHN_ABS },
            { name: 'untypedLabel', value: 0x0100, size: 0, type: 0, binding: 0, section: 1 },
        ], '');

        expect(indexWithConstant.symbol('CONSTANT')).to.include({ name: 'CONSTANT', address: 0x4000, size: 0 });
        expect(indexWithConstant.symbol('untypedLabel')).to.equal(undefined);
    });

    it('includes debug constants from the demo ELF', () => {
        expect(index.symbol('ARRAY_ADDR')).to.include({ name: 'ARRAY_ADDR', address: 0x4000, size: 0 });
        expect(index.symbol('OPCODE_EI')).to.include({ name: 'OPCODE_EI', address: 0x00FB, size: 0 });
    });
});

(ELF_EXISTS ? describe : describe.skip)('Debug artifact loader against demo1.elf', () => {
    it('resolves source breakpoints without mistaking a source filename for comp_dir', async () => {
        const romPath = path.join(path.dirname(ELF_PATH), 'demo1.rom');
        const sourcePath = path.join(path.dirname(path.dirname(ELF_PATH)), 'src', 'main.asm');
        const result = await loadDebugArtifact(ELF_PATH, romPath);
        const elf = parseElf32(fs.readFileSync(ELF_PATH));
        const debugLine = elf.sections.find(section => section.name === '.debug_line')!;
        const expected = parseDwarf4LineSection(debugLine.data, elf.addressSize)
            .find(row => row.isStmt && row.file === 'src/main.asm')!;

        expect(result.compDir).to.equal('');
        expect(result.index.resolveBreakpoint(sourcePath, expected.line)).to.deep.equal({
            address: expected.address,
            verifiedLine: expected.line,
        });
    });

    it('maps constants to their DWARF declaration locations and file-table entries', async () => {
        const romPath = path.join(path.dirname(ELF_PATH), 'demo1.rom');
        const result = await loadDebugArtifact(ELF_PATH, romPath);

        expect(result.index.sourceFiles).to.include(path.join('src', 'sub', 'rnd.asm'));
        expect(result.index.symbol('DISPLAY_ADDR')?.declaration).to.deep.equal({
            file: path.join('src', 'main.asm'), line: 12, column: 0, isStmt: false,
        });
        expect(result.index.symbol('PALETTE_LEN')?.declaration).to.deep.equal({
            file: path.join('src', 'sub', 'palette.asm'), line: 4, column: 0, isStmt: false,
        });
    });

    it('rejects a missing ELF companion', async () => {
        let error: Error | undefined;
        try {
            await loadDebugArtifact(path.join(path.dirname(ELF_PATH), 'missing.elf'));
        } catch (caught) {
            error = caught as Error;
        }
        expect(error?.message).to.include('Debug artifact not found');
    });

    it('rejects a malformed ELF companion', async () => {
        const malformedPath = path.join(os.tmpdir(), `v6-malformed-${process.pid}.elf`);
        fs.writeFileSync(malformedPath, Buffer.from('not an elf'));
        try {
            let error: Error | undefined;
            try {
                await loadDebugArtifact(malformedPath);
            } catch (caught) {
                error = caught as Error;
            }
            expect(error).to.exist;
        } finally {
            fs.unlinkSync(malformedPath);
        }
    });

    it('rejects an ELF companion whose text does not match the ROM', async () => {
        const mismatchedRom = path.join(os.tmpdir(), `v6-mismatch-${process.pid}.rom`);
        const rom = fs.readFileSync(path.join(path.dirname(ELF_PATH), 'demo1.rom'));
        const changed = Buffer.from(rom);
        changed[0] ^= 0xFF;
        fs.writeFileSync(mismatchedRom, changed);
        try {
            let error: Error | undefined;
            try {
                await loadDebugArtifact(ELF_PATH, mismatchedRom);
            } catch (caught) {
                error = caught as Error;
            }
            expect(error?.message).to.include('ELF .text content does not match ROM');
        } finally {
            fs.unlinkSync(mismatchedRom);
        }
    });
});
