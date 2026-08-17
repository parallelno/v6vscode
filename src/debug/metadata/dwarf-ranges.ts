/**
 * DWARF v4/v5 address-range parsing: low/high pairs, .debug_ranges (v4),
 * and .debug_rnglists (v5) with base-address handling.
 */

import { readULEB128 } from './elf32-reader';
import { DwarfError, requireRange } from './dwarf-sections';
import { CompilationUnit } from './dwarf-reader';

export interface AddressRange {
    start: number;
    end: number;
}

const DW_RLE_END_OF_LIST = 0x00;
const DW_RLE_BASE_ADDRESSX = 0x01;
const DW_RLE_STARTX_ENDX = 0x02;
const DW_RLE_STARTX_LENGTH = 0x03;
const DW_RLE_OFFSET_PAIR = 0x04;
const DW_RLE_START_END = 0x06;
const DW_RLE_START_LENGTH = 0x07;

export type AddressResolver = (index: number) => number;

/**
 * Parse a DWARF v5 .debug_rnglists list at the given offset.
 * baseAddress tracks DW_RLE_base_addressx; offset_pair values are relative to it.
 */
export function parseRngList(
    data: Buffer,
    offset: number,
    unit: CompilationUnit,
    resolveAddress: AddressResolver,
): AddressRange[] {
    const ranges: AddressRange[] = [];
    let base = 0;
    let cursor = offset;
    while (cursor < data.length) {
        const entry = data[cursor++];
        switch (entry) {
            case DW_RLE_END_OF_LIST:
                return ranges;
            case DW_RLE_BASE_ADDRESSX: {
                const [index, len] = readULEB128(data, cursor); cursor += len;
                base = resolveAddress(index);
                break;
            }
            case DW_RLE_STARTX_ENDX: {
                const [startIdx, a] = readULEB128(data, cursor); cursor += a;
                const [endIdx, b] = readULEB128(data, cursor); cursor += b;
                ranges.push({ start: resolveAddress(startIdx), end: resolveAddress(endIdx) });
                break;
            }
            case DW_RLE_STARTX_LENGTH: {
                const [startIdx, a] = readULEB128(data, cursor); cursor += a;
                const [length, b] = readULEB128(data, cursor); cursor += b;
                const start = resolveAddress(startIdx);
                ranges.push({ start, end: start + length });
                break;
            }
            case DW_RLE_OFFSET_PAIR: {
                const [startOff, a] = readULEB128(data, cursor); cursor += a;
                const [endOff, b] = readULEB128(data, cursor); cursor += b;
                ranges.push({ start: base + startOff, end: base + endOff });
                break;
            }
            case DW_RLE_START_END: {
                const start = readAddress(data, cursor, unit.addressSize); cursor += unit.addressSize;
                const end = readAddress(data, cursor, unit.addressSize); cursor += unit.addressSize;
                ranges.push({ start, end });
                break;
            }
            case DW_RLE_START_LENGTH: {
                const start = readAddress(data, cursor, unit.addressSize); cursor += unit.addressSize;
                const [length, len] = readULEB128(data, cursor); cursor += len;
                ranges.push({ start, end: start + length });
                break;
            }
            default:
                throw new DwarfError(`Unsupported DW_RLE entry 0x${entry.toString(16)}`, cursor - 1);
        }
    }
    return ranges;
}

function readAddress(data: Buffer, offset: number, size: number): number {
    return size === 2 ? data.readUInt16LE(offset) : data.readUInt32LE(offset);
}

/** Resolve an rnglistx index to a list offset within .debug_rnglists. */
export function rnglistOffset(data: Buffer, base: number, index: number): number {
    requireRange(data, 0, 10, 'rnglists header');
    const offsetEntryCount = data.readUInt32LE(4 + 2 + 1 + 1); // after length, version, addr_size, seg_size
    if (index >= offsetEntryCount) {
        throw new DwarfError(`rnglistx index ${index} out of range`, base);
    }
    const entryOffset = base + index * 4;
    requireRange(data, entryOffset, 4, 'rnglists offset');
    // Stored offsets are relative to the offset-array base.
    return base + data.readUInt32LE(entryOffset);
}

/** True when a PC lies inside any half-open range. */
export function inRanges(ranges: AddressRange[], pc: number): boolean {
    return ranges.some(range => pc >= range.start && pc < range.end);
}
