/**
 * String resolution for DWARF v4/v5 debug string sections.
 *
 * Supports .debug_str offsets (strp), .debug_line_str (line_strp), and
 * indexed strings (strx*) resolved through the CU's .debug_str_offsets base.
 */

import { readCString, readULEB128 } from './elf32-reader';
import { DwarfError, requireRange } from './dwarf-sections';

export class DwarfStrings {
    constructor(
        private readonly strings: Buffer,
        private readonly lineStrings: Buffer,
        private readonly stringOffsets: Buffer,
    ) {}

    atOffset(offset: number): string {
        requireRange(this.strings, offset, 1, 'DW_FORM_strp');
        return readCString(this.strings, offset);
    }

    lineAtOffset(offset: number): string {
        requireRange(this.lineStrings, offset, 1, 'DW_FORM_line_strp');
        return readCString(this.lineStrings, offset);
    }

    /** Resolve a DWARF v5 indexed string for a given base offset and index. */
    indexed(base: number, index: number, size: 1 | 2 | 4): string {
        const entryOffset = base + index * 4;
        requireRange(this.stringOffsets, entryOffset, 4, 'DW_FORM_strx');
        const stringOffset = this.stringOffsets.readUInt32LE(entryOffset);
        return this.atOffset(stringOffset);
    }
}

/** Size in bytes of a DWARF v5 strx index form. */
export function strxIndex(data: Buffer, offset: number, form: number): { index: number; consumed: number } {
    switch (form) {
        case 0x25: return { index: data[offset], consumed: 1 };              // strx1
        case 0x26: return { index: data.readUInt16LE(offset), consumed: 2 }; // strx2
        case 0x27: return { index: readUInt24(data, offset), consumed: 3 };  // strx3
        case 0x28: return { index: data.readUInt32LE(offset), consumed: 4 }; // strx4
        default: {
            const [index, consumed] = readULEB128(data, offset);             // strx (0x1A)
            return { index, consumed };
        }
    }
}

/** Read a 24-bit little-endian unsigned integer. */
export function readUInt24(data: Buffer, offset: number): number {
    return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}

/** DWARF error helper for truncated indexed strings. */
export function assertStringIndex(base: number): void {
    if (!Number.isInteger(base) || base < 0) {
        throw new DwarfError(`Invalid .debug_str_offsets base ${base}`);
    }
}
