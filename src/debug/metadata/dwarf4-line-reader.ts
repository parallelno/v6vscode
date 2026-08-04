/**
 * DWARF v4 .debug_line section parser — produces LineRow[] for the V6C 16-bit target.
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

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse a DWARF v4 .debug_line section and return all emitted line rows.
 *
 * @param data        Raw bytes of the .debug_line section.
 * @param addressSize Bytes per address (from .debug_info CU header; typically 2 for V6C).
 * @param compDir     Compilation directory from .debug_info DW_AT_comp_dir (may be '').
 */
export function parseDwarf4LineSection(
    data: Buffer,
    addressSize: number,
    compDir = '',
): LineRow[] {
    const rows: LineRow[] = [];
    let pos = 0;

    while (pos < data.length) {
        rows.push(...parseOneLineProgram(data, pos, addressSize, compDir));
        // Advance past this compilation unit
        const unitLen = data.readUInt32LE(pos);
        if (unitLen === 0) { break; }
        pos += 4 + unitLen;
    }

    return rows;
}

/** Return every source file declared by DWARF v4 line-program file tables. */
export function parseDwarf4LineFiles(data: Buffer, compDir = ''): string[] {
    const files: string[] = [];
    let base = 0;
    while (base + 10 <= data.length) {
        const unitLength = data.readUInt32LE(base);
        if (unitLength === 0 || base + 4 + unitLength > data.length) { break; }
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
): LineRow[] {
    const rows: LineRow[] = [];
    let p = base;

    // ---- Parse header ----
    const unitLength  = data.readUInt32LE(p); p += 4;
    const version     = data.readUInt16LE(p); p += 2;
    if (version !== 4) {
        throw new Error(`Unsupported DWARF line version: ${version}`);
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

    // Directory table (null-terminated strings, then empty string)
    const dirs: string[] = [''];  // index 0 is unused / comp_dir; 1-based table follows
    while (data[p] !== 0) {
        let s = ''; while (data[p] !== 0) { s += String.fromCharCode(data[p++]); }
        p++; // consume null
        dirs.push(s);
    }
    p++; // consume final null (empty string terminator)

    // File table (entries of: filename, dir_index, mtime, size)
    const files: string[] = [''];  // 1-based; index 0 unused
    while (data[p] !== 0) {
        let fname = ''; while (data[p] !== 0) { fname += String.fromCharCode(data[p++]); }
        p++; // consume null
        const [dirIdx, di] = readULEB128(data, p); p += di;
        const [, ti] = readULEB128(data, p); p += ti; // mtime (ignored)
        const [, si] = readULEB128(data, p); p += si; // size (ignored)
        files.push(resolveFilePath(fname, dirIdx, dirs, compDir));
    }
    p++; // consume file table terminator

    // Sanity: p should now equal base + 4 + 4 + 2 + headerLength = end of header
    const programStart = base + 4 + 2 + 4 + headerLength;

    // ---- State machine ----
    let address  = 0;
    let opIndex  = 0;
    let file     = 1;
    let line     = 1;
    let column   = 0;
    let isStmt   = defaultIsStmt;
    let basicBlock = false;
    let prologueEnd = false;
    let epilogueBegin = false;

    const emitRow = () => {
        if (file >= 1 && file < files.length) {
            rows.push({ address, file: files[file], line, column, isStmt });
        }
        basicBlock = false;
        prologueEnd = false;
        epilogueBegin = false;
    };

    const resetState = () => {
        address = 0; opIndex = 0; file = 1; line = 1; column = 0;
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
