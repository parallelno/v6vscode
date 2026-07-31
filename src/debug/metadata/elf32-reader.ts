/**
 * ELF32 little-endian binary parser for V6C debug companions.
 *
 * Supports:
 *   ELFCLASS32 (class=1), ELFDATA2LSB (data=1)
 *   Section headers, string tables, symbol tables
 *   e_machine 0x8080 (V6C / i8080)
 *
 * Verified against demo1.elf produced by v6asm -g:
 *   9 sections, e_shoff=1452, address_size=2 in .debug_info
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ELF_MAGIC  = 0x464C457F; // '\x7FELF' as LE uint32
export const ELFCLASS32 = 1;
export const ELFDATA2LSB = 1;

export const SHT_NULL     = 0;
export const SHT_PROGBITS = 1;
export const SHT_SYMTAB   = 2;
export const SHT_STRTAB   = 3;

export const STB_LOCAL  = 0;
export const STB_GLOBAL = 1;
export const STB_WEAK   = 2;

export const STT_NOTYPE  = 0;
export const STT_OBJECT  = 1;
export const STT_FUNC    = 2;
export const STT_SECTION = 3;
export const STT_FILE    = 4;

export const SHF_ALLOC    = 0x2;
export const SHF_EXECINSTR = 0x4;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

export interface Elf32Section {
    index: number;
    name: string;
    type: number;          // SHT_*
    flags: number;         // SHF_*
    addr: number;          // load address (0 for debug sections)
    size: number;
    link: number;
    info: number;
    entsize: number;
    data: Buffer;
}

export interface Elf32Symbol {
    name: string;
    value: number;         // CPU address
    size: number;
    binding: number;       // STB_*
    type: number;          // STT_*
    section: number;       // section index or SHN_* special value
}

export interface Elf32 {
    elfType: number;       // ET_EXEC=2, ET_REL=1
    machine: number;       // 0x8080 for V6C/i8080
    entry: number;         // entry point address
    sections: Elf32Section[];
    symbols: Elf32Symbol[];
    /** address_size in bytes from the first .debug_info CU header (1 or 2) */
    addressSize: number;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseElf32(buf: Buffer): Elf32 {
    // Validate magic
    if (buf.readUInt32LE(0) !== ELF_MAGIC) {
        throw new Error('Not an ELF file (bad magic)');
    }
    if (buf[4] !== ELFCLASS32) {
        throw new Error(`Expected ELFCLASS32, got ${buf[4]}`);
    }
    if (buf[5] !== ELFDATA2LSB) {
        throw new Error(`Expected little-endian ELF, got data encoding ${buf[5]}`);
    }

    const elfType = buf.readUInt16LE(16);
    const machine = buf.readUInt16LE(18);
    const entry   = buf.readUInt32LE(24);
    const shoff   = buf.readUInt32LE(32);
    const shentsize = buf.readUInt16LE(46);
    const shnum   = buf.readUInt16LE(48);
    const shstrndx = buf.readUInt16LE(50);

    if (shoff === 0 || shnum === 0) {
        throw new Error('ELF has no section header table');
    }

    // ---- Build section list ----
    // First pass: read raw sections (names resolved in second pass)
    const rawSections: Omit<Elf32Section, 'name'>[] = [];
    for (let i = 0; i < shnum; i++) {
        const s = shoff + i * shentsize;
        rawSections.push({
            index:   i,
            type:    buf.readUInt32LE(s + 4),
            flags:   buf.readUInt32LE(s + 8),
            addr:    buf.readUInt32LE(s + 12),
            size:    buf.readUInt32LE(s + 20),
            link:    buf.readUInt32LE(s + 24),
            info:    buf.readUInt32LE(s + 28),
            entsize: buf.readUInt32LE(s + 36),
            data:    sectionData(buf, shoff + i * shentsize),
        });
    }

    // Section name string table (.shstrtab)
    const shstrtab = rawSections[shstrndx]?.data ?? Buffer.alloc(0);

    // Second pass: resolve names
    const sections: Elf32Section[] = rawSections.map((rs, i) => {
        const nameOff = buf.readUInt32LE(shoff + i * shentsize);
        return { ...rs, name: readCString(shstrtab, nameOff) };
    });

    // ---- address_size from .debug_info CU header ----
    let addressSize = 2; // V6C default
    const debugInfo = sections.find(s => s.name === '.debug_info');
    if (debugInfo && debugInfo.data.length >= 11) {
        // DWARF4 CU header: unit_length(4) version(2) abbrev_offset(4) address_size(1)
        addressSize = debugInfo.data[10];
    }

    // ---- Parse .symtab ----
    const symbols: Elf32Symbol[] = [];
    const symtab = sections.find(s => s.type === SHT_SYMTAB);
    if (symtab && symtab.entsize === 16) {
        const strtabIdx = symtab.link;
        const strtab = sections[strtabIdx]?.data ?? Buffer.alloc(0);
        const count = symtab.data.length / 16;
        for (let i = 0; i < count; i++) {
            const e = symtab.data.slice(i * 16);
            const nameOff = e.readUInt32LE(0);
            const value   = e.readUInt32LE(4);
            const size    = e.readUInt32LE(8);
            const info    = e[12];
            const shndx   = e.readUInt16LE(14);
            symbols.push({
                name:    readCString(strtab, nameOff),
                value,
                size,
                binding: (info >> 4) & 0xF,
                type:    info & 0xF,
                section: shndx,
            });
        }
    }

    return { elfType, machine, entry, sections, symbols, addressSize };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sectionData(buf: Buffer, sectionHeaderOffset: number): Buffer {
    const offset = buf.readUInt32LE(sectionHeaderOffset + 16);
    const size   = buf.readUInt32LE(sectionHeaderOffset + 20);
    if (size === 0) { return Buffer.alloc(0); }
    return Buffer.from(buf.subarray(offset, offset + size));
}

export function readCString(buf: Buffer, offset: number): string {
    let end = offset;
    while (end < buf.length && buf[end] !== 0) { end++; }
    return buf.subarray(offset, end).toString('utf8');
}

/** Read an unsigned LEB128 value; returns [value, bytesConsumed]. */
export function readULEB128(buf: Buffer, offset: number): [number, number] {
    let value = 0, shift = 0, read = 0;
    while (true) {
        const byte = buf[offset + read++];
        value |= (byte & 0x7F) << shift;
        shift += 7;
        if ((byte & 0x80) === 0) { break; }
    }
    return [value, read];
}

/** Read a signed LEB128 value; returns [value, bytesConsumed]. */
export function readSLEB128(buf: Buffer, offset: number): [number, number] {
    let value = 0, shift = 0, read = 0, byte: number;
    do {
        byte = buf[offset + read++];
        value |= (byte & 0x7F) << shift;
        shift += 7;
    } while (byte & 0x80);
    // Sign-extend if the sign bit of the last group is set
    if (shift < 32 && (byte & 0x40)) {
        value |= -(1 << shift);
    }
    return [value, read];
}
