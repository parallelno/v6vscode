import { formatHex } from '../../shared/numbers';
import { STT_FUNC, STT_OBJECT } from '../metadata/elf32-reader';

/** Flat-ROM v6asm emits SHN_ABS for functions and data labels as well as constants. */
export function isAsmConstant(symbol: { absolute?: boolean; type?: number }): boolean {
    return symbol.absolute === true && symbol.type !== STT_FUNC && symbol.type !== STT_OBJECT;
}

export const ASM_HOVER_REQUEST = 'v6AsmHover';
export const ASM_BYTE_REGISTERS: ReadonlySet<string> = new Set(['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L', 'M']);
export const ASM_WORD_REGISTERS: ReadonlySet<string> = new Set(['AF', 'BC', 'DE', 'HL', 'SP', 'PC']);

export type AsmHoverTarget =
    | { kind: 'register' | 'symbol'; name: string }
    | { kind: 'instruction'; file: string; line: number };

export interface AsmHoverRow {
    label: string;
    value?: number;
    byteSize?: number;
    note?: string;
}

export function formatAsmHoverRow({ label, value, byteSize = 1, note = 'unavailable' }: AsmHoverRow): string {
    if (value === undefined) { return `${label}: ${note}`; }
    const magnitude = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    return `${label}: ${value} | ${sign}${formatHex(magnitude, byteSize * 2)} | ${sign}0b${magnitude.toString(2).padStart(byteSize * 8, '0')}`;
}

/** Length of a real 8080 encoding, including the CPU's undocumented jump/call aliases. */
export function instructionByteCount(opcode: number): number {
    if ((opcode & 0xC7) === 0x06 || (opcode & 0xC7) === 0xC6 || opcode === 0xD3 || opcode === 0xDB) { return 2; }
    if ((opcode & 0xCF) === 0x01 || (opcode & 0xE7) === 0x22 || (opcode & 0xC7) === 0xC2
        || (opcode & 0xC7) === 0xC4 || [0xC3, 0xCB, 0xCD, 0xDD, 0xED, 0xFD].includes(opcode)) { return 3; }
    return 1;
}
