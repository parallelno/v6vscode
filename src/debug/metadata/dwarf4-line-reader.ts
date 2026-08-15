/**
 * DWARF v4/v5 .debug_line section parser — produces LineRow[] for the V6C 16-bit target.
 *
 * Implements the full DWARF v4 line number program state machine including:
 *   - Standard opcodes (DW_LNS_copy through DW_LNS_set_isa)
 *   - Extended opcodes (DW_LNE_end_sequence, DW_LNE_set_address, DW_LNE_define_file)
 *   - Special opcodes (opcode >= opcode_base)
 *
 * Verified against demo1.elf: address_size=2, min_inst_len=1, line_base=-5,
 * line_range=14, opcode_base=13.
 */

import { readULEB128, readSLEB128, readCString } from './elf32-reader';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LineRow {
    /** 16-bit CPU address. */
    address: number;
    /** Normalized file path (directory + filename from the DWARF tables). */
    file: string;
    /** 1-based source line number. */
    line: number;
    /** 1-based column, or 0 if not specified. */
    column: number;
    /** True when this is a recommended breakpoint location (is_stmt). */
    isStmt: boolean;
}

// ---------------------------------------------------------------------------
// Standard opcode numbers
// ---------------------------------------------------------------------------

const DW_LNS_copy             = 1;
const DW_LNS_advance_pc       = 2;
const DW_LNS_advance_line     = 3;
const DW_LNS_set_file         = 4;
const DW_LNS_set_column       = 5;
const DW_LNS_negate_stmt      = 6;
const DW_LNS_set_basic_block  = 7;
const DW_LNS_const_add_pc     = 8;
const DW_LNS_fixed_advance_pc = 9;
const DW_LNS_set_prologue_end  = 10;
const DW_LNS_set_epilogue_begin = 11;
const DW_LNS_set_isa           = 12;

const DW_LNE_end_sequence    = 1;
const DW_LNE_set_address     = 2;
const DW_LNE_define_file     = 3;
const DW_LNE_set_discriminator = 4;

const DW_LNCT_PATH = 0x01;
const DW_LNCT_DIRECTORY_INDEX = 0x02;
const DW_FORM_DATA1 = 0x0B;
const DW_FORM_DATA2 = 0x05;
const DW_FORM_DATA4 = 0x06;
const DW_FORM_DATA8 = 0x07;
const DW_FORM_STRING = 0x08;
const DW_FORM_STRP = 0x0E;
const DW_FORM_UDATA = 0x0F;
const DW_FORM_LINE_STRP = 0x1F;
const DW_FORM_DATA16 = 0x1E;

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a DWARF v4 or v5 .debug_line section and return all emitted line rows.
 *
 * @param data        Raw bytes of the .debug_line section.
 * @param addressSize Bytes per address (from .debug_info CU header; typically 2 for V6C).
 * @param compDir     Compilation directory from .debug_info DW_AT_comp_dir (may be '').
 */
export function parseDwarf4LineSection(
    data: Buffer,
    addressSize: number,
    compDir = '',
    debugStrings: Buffer<ArrayBufferLike> = Buffer.alloc(0),
    lineStrings: Buffer<ArrayBufferLike> = Buffer.alloc(0),
): LineRow[] {
    const rows: LineRow[] = [];
    let pos = 0;

    while (pos < data.length) {
        rows.push(...parseOneLineProgram(data, pos, addressSize, compDir, debugStrings, lineStrings));
        // Advance past this compilation unit
        const unitLen = data.readUInt32LE(pos);
        if (unitLen === 0) { break; }
        pos += 4 + unitLen;
    }

    return rows;
}

/** Return every source file declared by DWARF v4 line-program file tables. */
export function parseDwarf4LineFiles(
    data: Buffer,
    compDir = '',
    debugStrings: Buffer<ArrayBufferLike> = Buffer.alloc(0),
    lineStrings: Buffer<ArrayBufferLike> = Buffer.alloc(0),
): string[] {
    const files: string[] = [];
    let base = 0;
    while (base + 10 <= data.length) {
        const unitLength = data.readUInt32LE(base);
        if (unitLength === 0 || base + 4 + unitLength > data.length) { break; }
        const version = data.readUInt16LE(base + 4);
        if (version === 5) {
            const addressSize = data[base + 6];
            files.push(...parseOneLineProgram(data, base, addressSize, compDir, debugStrings, lineStrings).map(row => row.file));
            base += 4 + unitLength;
            continue;
        }
        if (version !== 4) { throw new Error(`Unsupported DWARF line version: ${version}`); }
        let offset = base + 10;
        offset += 6 + data[offset + 5] - 1; // fixed header fields and standard-opcode lengths
        const dirs: string[] = [''];
        while (data[offset] !== 0) {
            const directory = readCString(data, offset);
            offset += Buffer.byteLength(directory) + 1;
            dirs.push(directory);
        }
        offset++;
        while (data[offset] !== 0) {
            const file = readCString(data, offset);
            offset += Buffer.byteLength(file) + 1;
            const [dirIndex, dirLength] = readULEB128(data, offset);
            offset += dirLength;
            const [, timeLength] = readULEB128(data, offset);
            offset += timeLength;
            const [, sizeLength] = readULEB128(data, offset);
            offset += sizeLength;
            files.push(resolveFilePath(file, dirIndex, dirs, compDir));
        }
        base += 4 + unitLength;
    }
    return [...new Set(files)];
}

function parseOneLineProgram(
    data: Buffer,
    base: number,
    addressSize: number,
    compDir: string,
    debugStrings: Buffer<ArrayBufferLike>,
    lineStrings: Buffer<ArrayBufferLike>,
): LineRow[] {
    const rows: LineRow[] = [];
    let p = base;

    // ---- Parse header ----
    const unitLength  = data.readUInt32LE(p); p += 4;
    const version     = data.readUInt16LE(p); p += 2;
    if (version !== 4 && version !== 5) {
        throw new Error(`Unsupported DWARF line version: ${version}`);
    }
    if (version === 5) {
        addressSize = data[p++];
        p++; // segment_selector_size; segmented addresses are not used by V6C.
    }
    const headerLength    = data.readUInt32LE(p); p += 4;
    const minInstrLen     = data[p++];
    const maxOpsPerInstr  = data[p++];
    const defaultIsStmt   = data[p++] !== 0;
    const lineBase        = data.readInt8(p++);
    const lineRange       = data[p++];
    const opcodeBase      = data[p++];

    // Standard opcode argument counts (opcodeBase-1 entries)
    const stdArgCounts: number[] = [];
    for (let i = 1; i < opcodeBase; i++) {
        stdArgCounts.push(data[p++]);
    }

    const dirs: string[] = [''];  // index 0 is unused / comp_dir; 1-based table follows
    const files: string[] = version === 5 ? [] : [''];
    if (version === 4) {
        while (data[p] !== 0) {
            const directory = readCString(data, p);
            p += Buffer.byteLength(directory) + 1;
            dirs.push(directory);
        }
        p++;
        while (data[p] !== 0) {
            const fname = readCString(data, p);
            p += Buffer.byteLength(fname) + 1;
            const [dirIdx, di] = readULEB128(data, p); p += di;
            const [, ti] = readULEB128(data, p); p += ti;
            const [, si] = readULEB128(data, p); p += si;
            files.push(resolveFilePath(fname, dirIdx, dirs, compDir));
        }
        p++;
    } else {
        const [v5Dirs, afterDirs] = readV5LineTable(data, p, debugStrings, lineStrings);
        p = afterDirs;
        const v5DirectoryPaths = v5Dirs.map(entry => String(entry.get(DW_LNCT_PATH) ?? ''));
        const v5CompDir = compDir || v5DirectoryPaths.find(directory => path.isAbsolute(directory)) || '';
        const [v5Files, afterFiles] = readV5LineTable(data, p, debugStrings, lineStrings);
        p = afterFiles;
        for (const entry of v5Files) {
            const filePath = String(entry.get(DW_LNCT_PATH) ?? '');
            const directory = v5DirectoryPaths[Number(entry.get(DW_LNCT_DIRECTORY_INDEX) ?? 0)] ?? '';
            files.push(resolveV5FilePath(filePath, directory, v5CompDir));
        }
    }
    p++; // consume file table terminator

    // Sanity: p should now equal base + 4 + 4 + 2 + headerLength = end of header
    const programStart = base + 4 + 2 + (version === 5 ? 2 : 0) + 4 + headerLength;

    // ---- State machine ----
    let address  = 0;
    let opIndex  = 0;
    let file     = version === 5 ? 0 : 1;
    let line     = 1;
    let column   = 0;
    let isStmt   = defaultIsStmt;
    let basicBlock = false;
    let prologueEnd = false;
    let epilogueBegin = false;

    const emitRow = () => {
        const firstFileIndex = version === 5 ? 0 : 1;
        if (file >= firstFileIndex && file < files.length) {
            rows.push({ address, file: files[file], line, column, isStmt });
        }
        basicBlock = false;
        prologueEnd = false;
        epilogueBegin = false;
    };

    const resetState = () => {
        address = 0; opIndex = 0; file = version === 5 ? 0 : 1; line = 1; column = 0;
        isStmt = defaultIsStmt; basicBlock = false;
        prologueEnd = false; epilogueBegin = false;
    };

    p = programStart;
    const unitEnd = base + 4 + unitLength;

    while (p < unitEnd && p < data.length) {
        const opcode = data[p++];

        if (opcode === 0) {
            // Extended opcode
            const [extLen, li] = readULEB128(data, p); p += li;
            const extOp = data[p++];
            const extEnd = p + extLen - 1;

            switch (extOp) {
                case DW_LNE_end_sequence:
                    emitRow();
                    resetState();
                    break;
                case DW_LNE_set_address:
                    address = addressSize === 2
                        ? data.readUInt16LE(p)
                        : data.readUInt32LE(p);
                    opIndex = 0;
                    break;
                case DW_LNE_define_file: {
                    let fname = ''; while (data[p] !== 0) { fname += String.fromCharCode(data[p++]); }
                    p++; // null
                    const [dirIdx, di] = readULEB128(data, p); p += di;
                    const [, ti] = readULEB128(data, p); p += ti;
                    const [, si] = readULEB128(data, p); p += si;
                    files.push(resolveFilePath(fname, dirIdx, dirs, compDir));
                    break;
                }
                case DW_LNE_set_discriminator: {
                    readULEB128(data, p); // discard
                    break;
                }
                default:
                    break; // skip unknown extended opcodes
            }
            p = extEnd;

        } else if (opcode < opcodeBase) {
            // Standard opcode
            switch (opcode) {
                case DW_LNS_copy:
                    emitRow();
                    break;
                case DW_LNS_advance_pc: {
                    const [op, i] = readULEB128(data, p); p += i;
                    address += minInstrLen * op;
                    break;
                }
                case DW_LNS_advance_line: {
                    const [delta, i] = readSLEB128(data, p); p += i;
                    line += delta;
                    break;
                }
                case DW_LNS_set_file: {
                    const [f, i] = readULEB128(data, p); p += i;
                    file = f;
                    break;
                }
                case DW_LNS_set_column: {
                    const [col, i] = readULEB128(data, p); p += i;
                    column = col;
                    break;
                }
                case DW_LNS_negate_stmt:
                    isStmt = !isStmt;
                    break;
                case DW_LNS_set_basic_block:
                    basicBlock = true;
                    break;
                case DW_LNS_const_add_pc:
                    address += minInstrLen * ((255 - opcodeBase) / lineRange | 0);
                    break;
                case DW_LNS_fixed_advance_pc:
                    address += data.readUInt16LE(p); p += 2;
                    break;
                case DW_LNS_set_prologue_end:
                    prologueEnd = true;
                    break;
                case DW_LNS_set_epilogue_begin:
                    epilogueBegin = true;
                    break;
                case DW_LNS_set_isa: {
                    const [, i] = readULEB128(data, p); p += i;
                    break;
                }
                default: {
                    // Unknown standard opcode — consume arguments per table
                    const argc = stdArgCounts[opcode - 1] ?? 0;
                    for (let a = 0; a < argc; a++) {
                        const [, i] = readULEB128(data, p); p += i;
                    }
                    break;
                }
            }

        } else {
            // Special opcode
            const adjusted = opcode - opcodeBase;
            const addrAdvance = minInstrLen * ((opIndex + (adjusted / lineRange | 0)) / maxOpsPerInstr | 0);
            const lineAdvance = lineBase + (adjusted % lineRange);
            address += addrAdvance;
            line    += lineAdvance;
            opIndex = (opIndex + (adjusted / lineRange | 0)) % maxOpsPerInstr;
            emitRow();
        }
    }

    return rows;
}

function readV5LineTable(
    data: Buffer,
    offset: number,
    debugStrings: Buffer<ArrayBufferLike>,
    lineStrings: Buffer<ArrayBufferLike>,
): [Array<Map<number, string | number>>, number] {
    const formatCount = data[offset++];
    const formats: Array<{ content: number; form: number }> = [];
    for (let index = 0; index < formatCount; index++) {
        const [content, contentLength] = readULEB128(data, offset); offset += contentLength;
        const [form, formLength] = readULEB128(data, offset); offset += formLength;
        formats.push({ content, form });
    }
    const [entryCount, entryCountLength] = readULEB128(data, offset);
    offset += entryCountLength;
    const entries: Array<Map<number, string | number>> = [];
    for (let index = 0; index < entryCount; index++) {
        const entry = new Map<number, string | number>();
        for (const format of formats) {
            const [value, valueLength] = readV5LineForm(data, offset, format.form, debugStrings, lineStrings);
            offset += valueLength;
            entry.set(format.content, value);
        }
        entries.push(entry);
    }
    return [entries, offset];
}

function readV5LineForm(
    data: Buffer,
    offset: number,
    form: number,
    debugStrings: Buffer<ArrayBufferLike>,
    lineStrings: Buffer<ArrayBufferLike>,
): [string | number, number] {
    switch (form) {
        case DW_FORM_STRING: {
            const value = readCString(data, offset);
            return [value, Buffer.byteLength(value) + 1];
        }
        case DW_FORM_STRP: {
            const stringOffset = data.readUInt32LE(offset);
            return [readCString(debugStrings, stringOffset), 4];
        }
        case DW_FORM_LINE_STRP: {
            const stringOffset = data.readUInt32LE(offset);
            return [readCString(lineStrings, stringOffset), 4];
        }
        case DW_FORM_DATA1: return [data[offset], 1];
        case DW_FORM_DATA2: return [data.readUInt16LE(offset), 2];
        case DW_FORM_DATA4: return [data.readUInt32LE(offset), 4];
        case DW_FORM_DATA8: return [Number(data.readBigUInt64LE(offset)), 8];
        case DW_FORM_DATA16: return [0, 16];
        case DW_FORM_UDATA: return readULEB128(data, offset);
        default: throw new Error(`Unsupported DWARF v5 line-table form ${form}`);
    }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function resolveFilePath(
    fname: string,
    dirIdx: number,
    dirs: string[],
    compDir: string,
): string {
    // Absolute paths need no further joining
    if (path.isAbsolute(fname)) { return path.normalize(fname); }

    const dir = dirIdx > 0 && dirIdx < dirs.length ? dirs[dirIdx] : '';
    const joined = dir ? `${dir}/${fname}` : fname;

    // If still relative, keep as-is; SourceMapService resolves against compDir
    return joined;
}

function resolveV5FilePath(file: string, directory: string, compDir: string): string {
    if (path.isAbsolute(file)) { return path.normalize(file); }
    if (directory) {
        return path.normalize(path.isAbsolute(directory) || !compDir
            ? path.join(directory, file)
            : path.join(compDir, directory, file));
    }
    return compDir ? path.normalize(path.join(compDir, file)) : file;
}
