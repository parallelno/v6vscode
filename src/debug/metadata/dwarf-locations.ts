/**
 * DWARF v5 .debug_loclists parsing and bounded expression evaluation.
 *
 * Produces raw location entries (PC range + expression bytes); the evaluator
 * interprets the V6C-supported DWARF expression subset against stopped
 * register/memory state supplied by the caller.
 */

import { readULEB128, readSLEB128 } from './elf32-reader';
import { DwarfError, requireRange } from './dwarf-sections';
import { CompilationUnit } from './dwarf-reader';
import { AddressRange } from './dwarf-ranges';

const DW_LLE_END_OF_LIST = 0x00;
const DW_LLE_BASE_ADDRESSX = 0x01;
const DW_LLE_STARTX_ENDX = 0x02;
const DW_LLE_OFFSET_PAIR = 0x04;
const DW_LLE_DEFAULT_LOCATION = 0x05;
const DW_LLE_START_END = 0x06;

export interface LocationListEntry {
    range: AddressRange | 'default';
    expression: Buffer;
}

export type AddressResolver = (index: number) => number;

/** Parse one location list; empty if the section or list is absent. */
export function parseLocationList(
    data: Buffer,
    offset: number,
    unit: CompilationUnit,
    resolveAddress: AddressResolver,
): LocationListEntry[] {
    if (data.length === 0) { return []; }
    const entries: LocationListEntry[] = [];
    let base = 0;
    let cursor = offset;
    while (cursor < data.length) {
        const kind = data[cursor++];
        switch (kind) {
            case DW_LLE_END_OF_LIST:
                return entries;
            case DW_LLE_BASE_ADDRESSX: {
                const [index, len] = readULEB128(data, cursor); cursor += len;
                base = resolveAddress(index);
                break;
            }
            case DW_LLE_STARTX_ENDX: {
                const [startIdx, a] = readULEB128(data, cursor); cursor += a;
                const [endIdx, b] = readULEB128(data, cursor); cursor += b;
                entries.push({ range: { start: resolveAddress(startIdx), end: resolveAddress(endIdx) }, expression: readExpression(data, cursor, out => cursor = out) });
                break;
            }
            case DW_LLE_OFFSET_PAIR: {
                const [startOff, a] = readULEB128(data, cursor); cursor += a;
                const [endOff, b] = readULEB128(data, cursor); cursor += b;
                const expression = readExpression(data, cursor, out => cursor = out);
                entries.push({ range: { start: base + startOff, end: base + endOff }, expression });
                break;
            }
            case DW_LLE_DEFAULT_LOCATION: {
                const expression = readExpression(data, cursor, out => cursor = out);
                entries.push({ range: 'default', expression });
                break;
            }
            case DW_LLE_START_END: {
                const start = data.readUInt16LE(cursor); cursor += 2;
                const end = data.readUInt16LE(cursor); cursor += 2;
                const expression = readExpression(data, cursor, out => cursor = out);
                entries.push({ range: { start, end }, expression });
                break;
            }
            default:
                throw new DwarfError(`Unsupported DW_LLE entry 0x${kind.toString(16)}`, cursor - 1);
        }
    }
    return entries;
}

function readExpression(data: Buffer, offset: number, advance: (next: number) => void): Buffer {
    const [size, len] = readULEB128(data, offset);
    requireRange(data, offset + len, size, 'DWARF location expression');
    advance(offset + len + size);
    return Buffer.from(data.subarray(offset + len, offset + len + size));
}

/** Resolve a loclistx index to a list offset within .debug_loclists. */
export function loclistOffset(data: Buffer, base: number, index: number): number {
    requireRange(data, 0, 10, 'loclists header');
    const offsetEntryCount = data.readUInt32LE(8);
    if (index >= offsetEntryCount) {
        throw new DwarfError(`loclistx index ${index} out of range`, base);
    }
    const entryOffset = base + index * 4;
    requireRange(data, entryOffset, 4, 'loclists offset');
    // Stored offsets are relative to the offset-array base.
    return base + data.readUInt32LE(entryOffset);
}

/** Select the expression active at a PC; returns undefined when no entry matches. */
export function locationAt(entries: LocationListEntry[], pc: number): Buffer | undefined {
    for (const entry of entries) {
        if (entry.range === 'default') { return entry.expression; }
        if (pc >= entry.range.start && pc < entry.range.end) { return entry.expression; }
    }
    return undefined;
}
