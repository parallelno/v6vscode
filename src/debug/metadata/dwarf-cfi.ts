/**
 * DWARF .debug_frame (CFI) parser and bounded evaluator for the V6C target.
 *
 * Parses CIE/FDE entries and produces PC-indexed unwind rows. Evaluation
 * recovers caller CFA/SP/registers from a stopped frame's register and memory
 * state. Only the CFI operations emitted by V6C are supported.
 */

import { readULEB128, readSLEB128 } from './elf32-reader';
import { DwarfError, requireRange } from './dwarf-sections';

// CFI operations
const DW_CFA_advance_loc = 0x40;      // high bits set: (op<<8)|delta, delta in low 6 bits
const DW_CFA_offset = 0x80;           // register in low 6 bits, ULEB offset*dataAlign
const DW_CFA_restore = 0xC0;
const DW_CFA_nop = 0x00;
const DW_CFA_set_loc = 0x01;
const DW_CFA_advance_loc1 = 0x02;
const DW_CFA_advance_loc2 = 0x03;
const DW_CFA_advance_loc4 = 0x04;
const DW_CFA_def_cfa = 0x0C;          // register, ULEB offset
const DW_CFA_def_cfa_register = 0x0D;
const DW_CFA_def_cfa_offset = 0x0E;
const DW_CFA_undefined = 0x07;        // register
const DW_CFA_same_value = 0x08;
const DW_CFA_register = 0x09;
const DW_CFA_remember_state = 0x0A;
const DW_CFA_restore_state = 0x0B;

export interface CfaRule {
    register: number;
    offset: number;
}

export type RegisterRule =
    | { kind: 'undefined' }
    | { kind: 'same_value' }
    | { kind: 'offset'; offset: number } // CFA-relative memory location
    | { kind: 'register'; register: number };

export interface UnwindRow {
    pc: number;          // start address this row covers
    cfa: CfaRule;
    registers: Map<number, RegisterRule>;
}

export interface FrameDescription {
    start: number;
    end: number;
    rows: UnwindRow[];
}

export interface Cie {
    offset: number;
    codeAlignment: number;
    dataAlignment: number;
    addressSize: number;
    returnAddressRegister: number;
    initialRules: UnwindRow;
}

export class DwarfCfi {
    readonly cies = new Map<number, Cie>();
    readonly fdes: FrameDescription[] = [];
    private readonly addressResolver: (index: number) => number;

    constructor(private readonly frame: Buffer, addressSize: number, addressResolver?: (index: number) => number) {
        this.addressResolver = addressResolver ?? (() => 0);
        this.parse();
    }

    /** Find the unwind row active at a PC. */
    rowAt(pc: number): UnwindRow | undefined {
        for (const fde of this.fdes) {
            if (pc >= fde.start && pc < fde.end) {
                let row = fde.rows[0];
                for (const candidate of fde.rows) {
                    if (candidate.pc > pc) { break; }
                    row = candidate;
                }
                return row;
            }
        }
        return undefined;
    }

    private parse(): void {
        let cursor = 0;
        while (cursor + 4 <= this.frame.length) {
            const length = this.frame.readUInt32LE(cursor);
            if (length === 0) { break; }
            if (length === 0xFFFFFFFF) { throw new DwarfError('DWARF64 frame entries are not supported', cursor); }
            const end = cursor + 4 + length;
            requireRange(this.frame, cursor, 4 + length, 'frame entry');
            const ciePointer = this.frame.readUInt32LE(cursor + 4);
            if (ciePointer === 0xFFFFFFFF) {
                this.parseCie(cursor, end);
            } else {
                this.parseFde(cursor, end, ciePointer);
            }
            cursor = end;
        }
    }

    private parseCie(offset: number, end: number): void {
        let cursor = offset + 8; // skip length and CIE id
        const version = this.frame[cursor++];
        const augmentationStart = cursor;
        while (cursor < end && this.frame[cursor] !== 0) { cursor++; }
        const augmentation = this.frame.subarray(augmentationStart, cursor).toString('utf8');
        cursor++;
        if (version !== 1 && version !== 4) {
            throw new DwarfError(`Unsupported CIE version ${version}`, offset);
        }
        let addressSize = 8;
        let segmentSize = 0;
        if (version === 4) {
            // DWARF4 CIE: address_size and segment_selector_size precede the
            // alignment factors.
            addressSize = this.frame[cursor++];
            segmentSize = this.frame[cursor++];
        }
        const [codeAlignment, caLen] = readULEB128(this.frame, cursor); cursor += caLen;
        const [dataAlignment, daLen] = readSLEB128(this.frame, cursor); cursor += daLen;
        const returnAddressRegister = version === 1
            ? this.frame[cursor++]
            : (() => { const [r, l] = readULEB128(this.frame, cursor); cursor += l; return r; })();

        if (augmentation === 'zR' || augmentation.startsWith('z')) {
            const [augLen, augLenBytes] = readULEB128(this.frame, cursor); cursor += augLenBytes;
            const augEnd = cursor + augLen;
            if (version !== 4 && augmentation.includes('a')) {
                addressSize = this.frame[cursor++];
                segmentSize = this.frame[cursor++];
            }
            cursor = augEnd;
        }

        const cie: Cie = {
            offset, codeAlignment, dataAlignment, addressSize, returnAddressRegister,
            initialRules: {
                pc: 0,
                cfa: { register: 0, offset: 0 },
                registers: new Map(),
            },
        };
        const initial = this.readInstructions(cursor, end, cie, {
            pc: 0, cfa: { register: 0, offset: 0 }, registers: new Map(),
        });
        cie.initialRules = initial;
        this.cies.set(offset, cie);
    }

    private parseFde(offset: number, end: number, ciePointer: number): void {
        const cie = this.cies.get(ciePointer) ?? this.cies.get(0);
        if (!cie) { throw new DwarfError(`FDE references unknown CIE ${ciePointer}`, offset); }
        let cursor = offset + 8;
        const addressSize = cie.addressSize === 8 ? 2 : cie.addressSize; // V6C 16-bit
        const start = addressSize === 2 ? this.frame.readUInt16LE(cursor) : this.frame.readUInt32LE(cursor);
        cursor += addressSize;
        const rangeLength = addressSize === 2 ? this.frame.readUInt16LE(cursor) : this.frame.readUInt32LE(cursor);
        cursor += addressSize;

        const rows: UnwindRow[] = [];
        const initialRow: UnwindRow = {
            pc: start,
            cfa: { ...cie.initialRules.cfa },
            registers: new Map(cie.initialRules.registers),
        };
        // Read all instructions; advance/set_loc produce new rows. The final
        // state applies from the last advance; we capture the state at `start`
        // by taking the first row if one exists, else the final state.
        const finalRow = this.readInstructions(cursor, end, cie, initialRow, rows);
        if (rows.length === 0) {
            rows.push({ pc: start, cfa: { ...finalRow.cfa }, registers: new Map(finalRow.registers) });
        }
        this.fdes.push({ start, end: start + rangeLength, rows });
    }

    private readInstructions(
        cursor: number,
        end: number,
        cie: Cie,
        startRow: UnwindRow,
        rows?: UnwindRow[],
    ): UnwindRow {
        let row: UnwindRow = {
            pc: startRow.pc,
            cfa: { ...startRow.cfa },
            registers: new Map(startRow.registers),
        };
        // Track whether any advance has produced a row; the first advance
        // captures the state built by the leading (non-advance) instructions.
        let firstRowPushed = false;
        const pushFirst = () => {
            if (rows && !firstRowPushed) {
                rows.push({ pc: row.pc, cfa: { ...row.cfa }, registers: new Map(row.registers) });
                firstRowPushed = true;
            }
        };
        const stateStack: Array<{ cfa: CfaRule; registers: Map<number, RegisterRule> }> = [];

        while (cursor < end) {
            const opcode = this.frame[cursor++];

            if ((opcode & 0xC0) === DW_CFA_advance_loc) {
                pushFirst();
                row = advance(row, (opcode & 0x3F) * cie.codeAlignment, rows);
                continue;
            }
            if ((opcode & 0xC0) === DW_CFA_offset) {
                const register = opcode & 0x3F;
                const [offset, len] = readULEB128(this.frame, cursor); cursor += len;
                row.registers.set(register, { kind: 'offset', offset: offset * cie.dataAlignment });
                continue;
            }
            if ((opcode & 0xC0) === DW_CFA_restore) {
                // V6C does not emit restore; treat conservatively as same_value removal.
                row.registers.delete(opcode & 0x3F);
                continue;
            }

            switch (opcode) {
                case DW_CFA_nop: break;
                case DW_CFA_set_loc: {
                    const addressSize = cie.addressSize === 8 ? 2 : cie.addressSize;
                    const address = addressSize === 2 ? this.frame.readUInt16LE(cursor) : this.frame.readUInt32LE(cursor);
                    cursor += addressSize;
                    row = { pc: address, cfa: { ...row.cfa }, registers: new Map(row.registers) };
                    if (rows) { rows.push(row); }
                    break;
                }
                case DW_CFA_advance_loc1: {
                    pushFirst();
                    row = advance(row, this.frame[cursor] * cie.codeAlignment, rows); cursor += 1;
                    break;
                }
                case DW_CFA_advance_loc2: {
                    pushFirst();
                    row = advance(row, this.frame.readUInt16LE(cursor) * cie.codeAlignment, rows); cursor += 2;
                    break;
                }
                case DW_CFA_advance_loc4: {
                    pushFirst();
                    row = advance(row, this.frame.readUInt32LE(cursor) * cie.codeAlignment, rows); cursor += 4;
                    break;
                }
                case DW_CFA_def_cfa: {
                    const [register, rl] = readULEB128(this.frame, cursor); cursor += rl;
                    const [offset, ol] = readULEB128(this.frame, cursor); cursor += ol;
                    row.cfa = { register, offset };
                    break;
                }
                case DW_CFA_def_cfa_register: {
                    const [register, len] = readULEB128(this.frame, cursor); cursor += len;
                    row.cfa = { register, offset: row.cfa.offset };
                    break;
                }
                case DW_CFA_def_cfa_offset: {
                    const [offset, len] = readULEB128(this.frame, cursor); cursor += len;
                    row.cfa = { register: row.cfa.register, offset };
                    break;
                }
                case DW_CFA_undefined: {
                    const [register, len] = readULEB128(this.frame, cursor); cursor += len;
                    row.registers.set(register, { kind: 'undefined' });
                    break;
                }
                case DW_CFA_same_value: {
                    const [register, len] = readULEB128(this.frame, cursor); cursor += len;
                    row.registers.set(register, { kind: 'same_value' });
                    break;
                }
                case DW_CFA_register: {
                    const [register, al] = readULEB128(this.frame, cursor); cursor += al;
                    const [source, bl] = readULEB128(this.frame, cursor); cursor += bl;
                    row.registers.set(register, { kind: 'register', register: source });
                    break;
                }
                case DW_CFA_remember_state:
                    stateStack.push({ cfa: { ...row.cfa }, registers: new Map(row.registers) });
                    break;
                case DW_CFA_restore_state: {
                    const state = stateStack.pop();
                    if (state) {
                        row = { pc: row.pc, cfa: state.cfa, registers: state.registers };
                    }
                    break;
                }
                default:
                    throw new DwarfError(`Unsupported DW_CFA opcode 0x${opcode.toString(16)}`, cursor - 1);
            }
        }
        return row;
    }
}

function advance(row: UnwindRow, delta: number, rows?: UnwindRow[]): UnwindRow {
    if (delta === 0) { return row; }
    const next: UnwindRow = {
        pc: row.pc + delta,
        cfa: { ...row.cfa },
        registers: new Map(row.registers),
    };
    // Push the row that becomes active after the advance.
    if (rows) { rows.push(next); }
    return next;
}
