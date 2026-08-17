/**
 * DWARF v4/v5 compilation-unit and DIE reader for the V6C 16-bit target.
 *
 * Produces a generic, immutable tree of Debugging Information Entries without
 * interpreting semantics; higher layers (types, scopes, frames) consume it.
 * Supported forms are the subset emitted by the V6C producer contract plus
 * the integer/string/flag/address forms needed to skip unknown attributes.
 */

import { readULEB128, readSLEB128, readCString } from './elf32-reader';
import { DwarfError, requireRange } from './dwarf-sections';
import { DwarfStrings, readUInt24, strxIndex } from './dwarf-strings';

// ---------------------------------------------------------------------------
// DWARF form codes
// ---------------------------------------------------------------------------

export const DW_FORM = {
    addr: 0x01, block2: 0x03, block4: 0x04, data2: 0x05, block1: 0x09,
    data1: 0x0B, data4: 0x06, data8: 0x07, string: 0x08, block: 0x09,
    data16: 0x1E, sdata: 0x0D, strp: 0x0E, udata: 0x0F, ref_addr: 0x10,
    ref1: 0x11, ref2: 0x12, ref4: 0x13, ref8: 0x14, ref_udata: 0x15,
    indirect: 0x16, sec_offset: 0x17, exprloc: 0x18, flag_present: 0x19,
    strx: 0x1A, addrx: 0x1B, data16_dup: 0x1E, line_strp: 0x1F, ref_sig8: 0x20,
    implicit_const: 0x21, loclistx: 0x22, rnglistx: 0x23,
    strx1: 0x25, strx2: 0x26, strx3: 0x27, strx4: 0x28,
    addrx1: 0x29, addrx2: 0x2A, addrx3: 0x2B, addrx4: 0x2C,
    flag: 0x0C,
} as const;

// Common attribute codes used by the V6C producer.
export const DW_AT = {
    name: 0x03, ordering: 0x09, byte_size: 0x0B, size: 0x02, stmt_list: 0x10,
    low_pc: 0x11, high_pc: 0x12, language: 0x13, discriminator: 0x15,
    const_value: 0x1C, containing_type: 0x1D, default_value: 0x1E,
    inline: 0x20, is_optional: 0x21, location: 0x02, comp_dir: 0x1B,
    producer: 0x25, prototyped: 0x27, return_addr: 0x2A, start_scope: 0x2C,
    frame_base: 0x40, ranges: 0x55, call_file: 0x58, call_line: 0x59,
    call_column: 0x5A, type: 0x49, data_member_location: 0x38, decl_file: 0x3A,
    decl_line: 0x3B, decl_column: 0x39, abstract_origin: 0x31,
    specification: 0x47, address_class: 0x33, count: 0x37, external: 0x3F,
    accessibility: 0x32, linkage_name: 0x6E, encoding: 0x3E, bit_size: 0x0D,
    str_offsets_base: 0x72, addr_base: 0x73, rnglists_base: 0x74,
    loclists_base: 0x8C, call_all_calls: 0x7A, constant: 0x1F, sibling: 0x01,
} as const;

export const DW_TAG = {
    compile_unit: 0x11, subprogram: 0x2E, variable: 0x34,
    formal_parameter: 0x05, lexical_block: 0x0B, inlined_subroutine: 0x1D,
    base_type: 0x24, pointer_type: 0x0F, reference_type: 0x10,
    const_type: 0x26, volatile_type: 0x35, restrict_type: 0x37,
    atomic_type: 0x47, typedef: 0x16, array_type: 0x01, subrange_type: 0x21,
    structure_type: 0x13, union_type: 0x17, member: 0x0D,
    enumeration_type: 0x04, enumerator: 0x28, subroutine_type: 0x15,
    unspecified_type: 0x3B,
} as const;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/** An attribute value with its encoded form. */
export interface DieAttribute {
    name: number;
    form: number;
    /** The decoded scalar/string/block value; undefined for flag_present. */
    value: number | bigint | string | Buffer | boolean;
    /** For string forms, the resolved string. */
    string?: string;
}

export interface Die {
    /** Section offset of this DIE within .debug_info (unit-local). */
    offset: number;
    tag: number;
    hasChildren: boolean;
    attributes: DieAttribute[];
    children: Die[];
}

export interface CompilationUnit {
    /** Absolute offset of the unit header in .debug_info. */
    offset: number;
    version: number;
    unitType: number;
    addressSize: number;
    abbrevOffset: number;
    /** .debug_str_offsets base used for strx forms. */
    strOffsetsBase: number;
    /** .debug_addr base used for addrx forms. */
    addrBase: number;
    /** .debug_rnglists base used for rnglistx forms. */
    rnglistsBase: number;
    /** .debug_loclists base used for loclistx forms. */
    loclistsBase: number;
    root: Die | undefined;
}

interface Abbreviation {
    tag: number;
    hasChildren: boolean;
    attributes: Array<{ name: number; form: number; implicitValue?: bigint }>;
}

// ---------------------------------------------------------------------------
// Public reader
// ---------------------------------------------------------------------------

export class DwarfReader {
    constructor(
        private readonly info: Buffer,
        private readonly abbrev: Buffer,
        private readonly strings: DwarfStrings,
        private readonly addressTable: Buffer,
    ) {}

    /** Parse all compilation units in .debug_info. */
    readUnits(): CompilationUnit[] {
        const units: CompilationUnit[] = [];
        let offset = 0;
        while (offset + 4 <= this.info.length) {
            const unitLength = this.info.readUInt32LE(offset);
            if (unitLength === 0 || unitLength === 0xFFFFFFFF) {
                if (unitLength === 0xFFFFFFFF) {
                    throw new DwarfError('DWARF64 is not supported', offset);
                }
                break;
            }
            if (offset + 4 + unitLength > this.info.length) {
                throw new DwarfError('Truncated compilation unit', offset);
            }
            units.push(this.readUnit(offset, unitLength));
            offset += 4 + unitLength;
        }
        return units;
    }

    /** Resolve an addrx index to a 16-bit address using the unit base. */
    resolveAddress(unit: CompilationUnit, index: number): number {
        const entry = unit.addrBase + index * unit.addressSize;
        requireRange(this.addressTable, entry, unit.addressSize, 'DW_FORM_addrx');
        return unit.addressSize === 2
            ? this.addressTable.readUInt16LE(entry)
            : this.addressTable.readUInt32LE(entry);
    }

    private readUnit(offset: number, unitLength: number): CompilationUnit {
        const version = this.info.readUInt16LE(offset + 4);
        let cursor: number;
        let unitType = 1; // DW_UT_compile
        let addressSize = 8;
        let abbrevOffset: number;

        if (version === 5) {
            unitType = this.info[offset + 6];
            addressSize = this.info[offset + 7];
            abbrevOffset = this.info.readUInt32LE(offset + 8);
            cursor = offset + 12;
        } else if (version === 4) {
            abbrevOffset = this.info.readUInt32LE(offset + 6);
            addressSize = this.info[offset + 10];
            cursor = offset + 11;
        } else {
            throw new DwarfError(`Unsupported DWARF info version ${version}`, offset);
        }

        const unit: CompilationUnit = {
            offset, version, unitType, addressSize, abbrevOffset,
            strOffsetsBase: 0, addrBase: 0, rnglistsBase: 0, loclistsBase: 0,
            root: undefined,
        };
        const unitEnd = offset + 4 + unitLength;

        // First pass: parse the root DIE with provisional zero bases so we can
        // read the CU's own base attributes (str_offsets_base, addr_base, etc.).
        // Indexed string/address forms are wrong in this pass; bases are not.
        const provisionalRoot = this.readDie(unit, cursor, unitEnd, 0).die;
        if (provisionalRoot) {
            unit.strOffsetsBase = numberAttribute(provisionalRoot, DW_AT.str_offsets_base) ?? 0;
            unit.addrBase = numberAttribute(provisionalRoot, DW_AT.addr_base) ?? 0;
            unit.rnglistsBase = numberAttribute(provisionalRoot, DW_AT.rnglists_base) ?? 0;
            unit.loclistsBase = numberAttribute(provisionalRoot, DW_AT.loclists_base) ?? 0;
        }

        // Second pass: re-parse with correct bases so strx/addrx resolve correctly.
        const root = this.readDie(unit, cursor, unitEnd, 0).die;
        unit.root = root;
        return unit;
    }

    private readDie(
        unit: CompilationUnit,
        cursor: number,
        unitEnd: number,
        depth: number,
    ): { die: Die | undefined; next: number } {
        requireRange(this.info, cursor, 1, 'DIE abbreviation code');
        const [code, codeLen] = readULEB128(this.info, cursor);
        cursor += codeLen;
        if (code === 0) { return { die: undefined, next: cursor }; } // null entry
        if (depth > 128) { throw new DwarfError('DIE nesting too deep', cursor); }

        const abbrev = this.abbreviations(unit).get(code);
        if (!abbrev) { throw new DwarfError(`Unknown DWARF abbreviation ${code}`, cursor); }

        const die: Die = {
            offset: cursor - codeLen,
            tag: abbrev.tag,
            hasChildren: abbrev.hasChildren,
            attributes: [],
            children: [],
        };

        for (const attr of abbrev.attributes) {
            die.attributes.push(this.readAttribute(unit, cursor, attr));
            cursor = this.attributeEnd(cursor, attr, unit);
        }

        if (abbrev.hasChildren) {
            while (cursor < unitEnd) {
                const child = this.readDie(unit, cursor, unitEnd, depth + 1);
                cursor = child.next;
                if (!child.die) { break; }
                die.children.push(child.die);
            }
        }
        return { die, next: cursor };
    }

    private abbreviations(unit: CompilationUnit): Map<number, Abbreviation> {
        const table = new Map<number, Abbreviation>();
        let cursor = unit.abbrevOffset;
        while (cursor < this.abbrev.length) {
            const [code, cl] = readULEB128(this.abbrev, cursor); cursor += cl;
            if (code === 0) { break; }
            const [tag, tl] = readULEB128(this.abbrev, cursor); cursor += tl;
            const hasChildren = this.abbrev[cursor++] !== 0;
            const attributes: Abbreviation['attributes'] = [];
            while (cursor < this.abbrev.length) {
                const [name, nl] = readULEB128(this.abbrev, cursor); cursor += nl;
                const [form, fl] = readULEB128(this.abbrev, cursor); cursor += fl;
                if (name === 0 && form === 0) { break; }
                let implicitValue: bigint | undefined;
                if (form === DW_FORM.implicit_const) {
                    const [value, vl] = readSLEB128(this.abbrev, cursor); cursor += vl;
                    implicitValue = BigInt(value);
                }
                attributes.push({ name, form, implicitValue });
            }
            table.set(code, { tag, hasChildren, attributes });
        }
        return table;
    }

    // ---- Attribute decoding ----

    private readAttribute(
        unit: CompilationUnit,
        cursor: number,
        attr: { name: number; form: number; implicitValue?: bigint },
    ): DieAttribute {
        const { name, form, implicitValue } = attr;
        const base = { name, form, value: 0 as number | bigint | string | Buffer | boolean };

        switch (form) {
            case DW_FORM.flag_present:
                return { ...base, value: true };
            case DW_FORM.flag:
                return { ...base, value: this.info[cursor] !== 0 };
            case DW_FORM.implicit_const:
                return { ...base, value: implicitValue ?? BigInt(0) };
            case DW_FORM.string: {
                const value = readCString(this.info, cursor);
                return { ...base, value, string: value };
            }
            case DW_FORM.strp: {
                const offset = this.info.readUInt32LE(cursor);
                const value = this.strings.atOffset(offset);
                return { ...base, value, string: value };
            }
            case DW_FORM.line_strp: {
                const offset = this.info.readUInt32LE(cursor);
                const value = this.strings.lineAtOffset(offset);
                return { ...base, value, string: value };
            }
            case DW_FORM.strx:
            case DW_FORM.strx1:
            case DW_FORM.strx2:
            case DW_FORM.strx3:
            case DW_FORM.strx4: {
                const { index } = strxIndex(this.info, cursor, form);
                const value = this.strings.indexed(unit.strOffsetsBase, index, this.strxSize(form));
                return { ...base, value, string: value };
            }
            case DW_FORM.addr:
                return { ...base, value: this.readRawAddress(unit, cursor) };
            case DW_FORM.addrx:
            case DW_FORM.addrx1:
            case DW_FORM.addrx2:
            case DW_FORM.addrx3:
            case DW_FORM.addrx4: {
                const { index } = strxIndex(this.info, cursor, form);
                return { ...base, value: this.resolveAddress(unit, index) };
            }
            case DW_FORM.block1: {
                const size = this.info[cursor];
                requireRange(this.info, cursor + 1, size, 'DW_FORM_block1');
                return { ...base, value: Buffer.from(this.info.subarray(cursor + 1, cursor + 1 + size)) };
            }
            case DW_FORM.block2: {
                const size = this.info.readUInt16LE(cursor);
                requireRange(this.info, cursor + 2, size, 'DW_FORM_block2');
                return { ...base, value: Buffer.from(this.info.subarray(cursor + 2, cursor + 2 + size)) };
            }
            case DW_FORM.block4: {
                const size = this.info.readUInt32LE(cursor);
                requireRange(this.info, cursor + 4, size, 'DW_FORM_block4');
                return { ...base, value: Buffer.from(this.info.subarray(cursor + 4, cursor + 4 + size)) };
            }
            case DW_FORM.block:
            case DW_FORM.exprloc: {
                const [size, len] = readULEB128(this.info, cursor);
                requireRange(this.info, cursor + len, size, 'DW_FORM_exprloc');
                return { ...base, value: Buffer.from(this.info.subarray(cursor + len, cursor + len + size)) };
            }
            case DW_FORM.data1: return { ...base, value: this.info[cursor] };
            case DW_FORM.data2: return { ...base, value: this.info.readUInt16LE(cursor) };
            case DW_FORM.data4: return { ...base, value: this.info.readUInt32LE(cursor) };
            case DW_FORM.data8: return { ...base, value: this.info.readBigUInt64LE(cursor) };
            case DW_FORM.data16: return { ...base, value: Buffer.from(this.info.subarray(cursor, cursor + 16)) };
            case DW_FORM.sdata: {
                const [value] = readSLEB128(this.info, cursor);
                return { ...base, value };
            }
            case DW_FORM.udata: {
                const [value] = readULEB128(this.info, cursor);
                return { ...base, value };
            }
            case DW_FORM.sec_offset:
            case DW_FORM.loclistx:
            case DW_FORM.rnglistx: {
                const [value] = readULEB128(this.info, cursor);
                return { ...base, value };
            }
            case DW_FORM.ref1: return { ...base, value: unit.offset + this.info[cursor] };
            case DW_FORM.ref2: return { ...base, value: unit.offset + this.info.readUInt16LE(cursor) };
            case DW_FORM.ref4: return { ...base, value: unit.offset + this.info.readUInt32LE(cursor) };
            case DW_FORM.ref8: return { ...base, value: Number(this.info.readBigUInt64LE(cursor)) };
            case DW_FORM.ref_udata: {
                const [value] = readULEB128(this.info, cursor);
                return { ...base, value };
            }
            default:
                throw new DwarfError(`Unsupported DWARF form 0x${form.toString(16)}`, cursor);
        }
    }

    private strxSize(form: number): 1 | 2 | 4 {
        switch (form) {
            case DW_FORM.strx1: case DW_FORM.addrx1: return 1;
            case DW_FORM.strx2: case DW_FORM.addrx2: return 2;
            default: return 4;
        }
    }

    private readRawAddress(unit: CompilationUnit, cursor: number): number {
        return unit.addressSize === 2
            ? this.info.readUInt16LE(cursor)
            : this.info.readUInt32LE(cursor);
    }

    /** Advance past an attribute's encoded value. */
    private attributeEnd(cursor: number, attr: { form: number }, unit: CompilationUnit): number {
        switch (attr.form) {
            case DW_FORM.flag_present: case DW_FORM.implicit_const: return cursor;
            case DW_FORM.flag: case DW_FORM.data1: case DW_FORM.ref1:
            case DW_FORM.strx1: case DW_FORM.addrx1: return cursor + 1;
            case DW_FORM.data2: case DW_FORM.ref2: case DW_FORM.strx2: case DW_FORM.addrx2: return cursor + 2;
            case DW_FORM.data4: case DW_FORM.sec_offset: case DW_FORM.ref4:
            case DW_FORM.strp: case DW_FORM.line_strp: case DW_FORM.strx4: case DW_FORM.addrx4:
            case DW_FORM.strx3: case DW_FORM.addrx3: return cursor + (attr.form === DW_FORM.strx3 || attr.form === DW_FORM.addrx3 ? 3 : 4);
            case DW_FORM.data8: case DW_FORM.ref8: return cursor + 8;
            case DW_FORM.data16: return cursor + 16;
            case DW_FORM.string: {
                let end = cursor;
                while (end < this.info.length && this.info[end] !== 0) { end++; }
                return end + 1;
            }
            case DW_FORM.sdata: case DW_FORM.udata: case DW_FORM.ref_udata:
            case DW_FORM.loclistx: case DW_FORM.rnglistx: case DW_FORM.strx: case DW_FORM.addrx:
            case DW_FORM.indirect:
                return cursor + readULEB128(this.info, cursor)[1];
            case DW_FORM.block: case DW_FORM.exprloc: {
                const [size, len] = readULEB128(this.info, cursor);
                return cursor + len + size;
            }
            case DW_FORM.block1: return cursor + 1 + this.info[cursor];
            case DW_FORM.block2: return cursor + 2 + this.info.readUInt16LE(cursor);
            case DW_FORM.block4: return cursor + 4 + this.info.readUInt32LE(cursor);
            case DW_FORM.addr: return cursor + unit.addressSize;
            default:
                throw new DwarfError(`Unsupported DWARF form 0x${attr.form.toString(16)}`, cursor);
        }
    }

    private static readonly uint24 = readUInt24;
}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

/** Find an attribute on a DIE. */
export function attribute(die: Die, name: number): DieAttribute | undefined {
    return die.attributes.find(a => a.name === name);
}

/** Numeric attribute value, or undefined. Accepts number or bigint. */
export function numberAttribute(die: Die, name: number): number | undefined {
    const attr = attribute(die, name);
    if (!attr) { return undefined; }
    if (typeof attr.value === 'number') { return attr.value; }
    if (typeof attr.value === 'bigint') { return Number(attr.value); }
    return undefined;
}

/** String attribute value, or undefined. */
export function stringAttribute(die: Die, name: number): string | undefined {
    const attr = attribute(die, name);
    return attr?.string ?? (typeof attr?.value === 'string' ? attr.value : undefined);
}

/** Buffer attribute value (exprloc/block), or undefined. */
export function blockAttribute(die: Die, name: number): Buffer | undefined {
    const attr = attribute(die, name);
    return Buffer.isBuffer(attr?.value) ? attr.value : undefined;
}

/** Boolean attribute value; absent/flag forms yield the default. */
export function flagAttribute(die: Die, name: number): boolean {
    const attr = attribute(die, name);
    return attr ? Boolean(attr.value) : false;
}
