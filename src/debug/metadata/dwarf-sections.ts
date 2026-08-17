/**
 * Bounded reader for the DWARF sections of a parsed V6C ELF32 companion.
 *
 * Centralizes section lookup and offset validation so the DIE, range,
 * location, and CFI readers never read outside their section.
 */

import { Elf32 } from './elf32-reader';

export class DwarfError extends Error {
    constructor(message: string, readonly offset?: number) {
        super(offset === undefined ? message : `${message} at offset 0x${offset.toString(16)}`);
        this.name = 'DwarfError';
    }
}

export class DwarfSections {
    readonly info: Buffer;
    readonly abbrev: Buffer;
    readonly strings: Buffer;
    readonly lineStrings: Buffer;
    readonly stringOffsets: Buffer;
    readonly addressTable: Buffer;
    readonly ranges: Buffer;
    readonly locationLists: Buffer;
    readonly frame: Buffer;
    readonly ehFrame: Buffer;

    constructor(elf: Elf32) {
        const section = (name: string) => elf.sections.find(s => s.name === name)?.data ?? Buffer.alloc(0);
        this.info = section('.debug_info');
        this.abbrev = section('.debug_abbrev');
        this.strings = section('.debug_str');
        this.lineStrings = section('.debug_line_str');
        this.stringOffsets = section('.debug_str_offsets');
        this.addressTable = section('.debug_addr');
        this.ranges = section('.debug_rnglists');
        this.locationLists = section('.debug_loclists');
        this.frame = section('.debug_frame');
        this.ehFrame = section('.eh_frame');
    }

    get hasInfo(): boolean { return this.info.length > 0; }
}

/** Throw if [offset, offset+size) does not fit inside a buffer. */
export function requireRange(buffer: Buffer, offset: number, size: number, context: string): void {
    if (offset < 0 || size < 0 || offset + size > buffer.length) {
        throw new DwarfError(`${context}: out of bounds (offset 0x${offset.toString(16)}, size ${size}, section 0x${buffer.length.toString(16)})`, offset);
    }
}
