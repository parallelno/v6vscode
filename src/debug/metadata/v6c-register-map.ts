/**
 * Maps a v6emul GET_REGS response onto the frozen V6C DWARF register numbers
 * (contract version 1). FLAGS and PSW have no DWARF number and are omitted.
 *
 * Contract (v6llvmc/docs/V6CDebugABI.md):
 *   0:A 1:B 2:C 3:D 4:E 5:H 6:L 7:BC 8:DE 9:HL 10:SP 11:PC
 */

import { GetRegsResponse } from '../../emulator/protocol/ipc-commands';

export const DWARF_REG = {
    A: 0, B: 1, C: 2, D: 3, E: 4, H: 5, L: 6,
    BC: 7, DE: 8, HL: 9, SP: 10, PC: 11,
} as const;

/** Translate a GET_REGS snapshot into DWARF-numbered registers. */
export function toDwarfRegisters(regs: GetRegsResponse): Record<number, number> {
    const a = (regs.af >> 8) & 0xFF;
    const b = (regs.bc >> 8) & 0xFF;
    const c = regs.bc & 0xFF;
    const d = (regs.de >> 8) & 0xFF;
    const e = regs.de & 0xFF;
    const h = (regs.hl >> 8) & 0xFF;
    const l = regs.hl & 0xFF;
    return {
        [DWARF_REG.A]: a,
        [DWARF_REG.B]: b,
        [DWARF_REG.C]: c,
        [DWARF_REG.D]: d,
        [DWARF_REG.E]: e,
        [DWARF_REG.H]: h,
        [DWARF_REG.L]: l,
        [DWARF_REG.BC]: regs.bc,
        [DWARF_REG.DE]: regs.de,
        [DWARF_REG.HL]: regs.hl,
        [DWARF_REG.SP]: regs.sp,
        [DWARF_REG.PC]: regs.pc,
    };
}
