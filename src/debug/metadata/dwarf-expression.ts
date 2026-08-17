/**
 * Bounded DWARF v5 expression evaluator for the V6C-supported operation set.
 *
 * Evaluates a location expression against explicit register/CFA/memory state.
 * Only the operations verified in V6C output are implemented; anything else
 * yields an unavailable result rather than aborting the session.
 */

import { readULEB128, readSLEB128 } from './elf32-reader';
import { AddressResolver } from './dwarf-locations';

export interface DwarfEvalContext {
    registers: Readonly<Record<number, number>>;
    cfa: number;
    frameBase: number;
    addressSize: number;
    readMemory: (address: number, byteSize: number) => number | undefined;
    resolveAddress: AddressResolver;
}

export type EvaluatedLocation =
    | { kind: 'memory'; address: number }
    | { kind: 'register'; register: number }
    | { kind: 'value'; value: number }
    | { kind: 'unavailable'; reason: string };

const MAX_OPERATIONS = 256;
const MAX_STACK = 64;

export function evaluateDwarfExpression(expression: Buffer, context: DwarfEvalContext): EvaluatedLocation {
    const stack: number[] = [];
    let operations = 0;
    let isValue = false;
    let registerResult: number | undefined;
    let cursor = 0;

    while (cursor < expression.length) {
        if (++operations > MAX_OPERATIONS) {
            return { kind: 'unavailable', reason: 'expression operation limit' };
        }
        const op = expression[cursor++];

        if (op >= 0x50 && op <= 0x6F) { registerResult = op - 0x50; continue; } // DW_OP_reg0..31
        if (op >= 0x90 && op <= 0xAF) { // DW_OP_breg0..31
            const register = op - 0x90;
            const [offset, len] = readSLEB128(expression, cursor); cursor += len;
            const value = context.registers[register];
            if (value === undefined) { return { kind: 'unavailable', reason: `register ${register} unavailable` }; }
            if (!push(stack, value + offset)) { return { kind: 'unavailable', reason: 'stack overflow' }; }
            continue;
        }
        if (op >= 0x30 && op <= 0x4F) { // DW_OP_lit0..31
            if (!push(stack, op - 0x30)) { return { kind: 'unavailable', reason: 'stack overflow' }; }
            continue;
        }

        switch (op) {
            case 0x03: { // DW_OP_addr
                const value = context.addressSize === 2 ? expression.readUInt16LE(cursor) : expression.readUInt32LE(cursor);
                cursor += context.addressSize;
                if (!push(stack, value)) { return { kind: 'unavailable', reason: 'stack overflow' }; }
                break;
            }
            case 0xA1: { // DW_OP_addrx
                const [index, len] = readULEB128(expression, cursor); cursor += len;
                if (!push(stack, context.resolveAddress(index))) { return { kind: 'unavailable', reason: 'stack overflow' }; }
                break;
            }
            case 0x06: { // DW_OP_deref
                const address = pop(stack);
                if (address === undefined) { return underflow(); }
                const value = context.readMemory(address & 0xFFFF, context.addressSize);
                if (value === undefined) { return { kind: 'unavailable', reason: 'memory read failed' }; }
                push(stack, value);
                break;
            }
            case 0x22: { const r = binary(stack, (a, b) => a + b); if (r) { return r; } break; } // DW_OP_plus
            case 0x1C: { const r = binary(stack, (a, b) => a - b); if (r) { return r; } break; } // DW_OP_minus
            case 0x1B: { // DW_OP_div
                const b = pop(stack); const a = pop(stack);
                if (a === undefined || b === undefined) { return underflow(); }
                push(stack, b === 0 ? 0 : Math.trunc(a / b));
                break;
            }
            case 0x21: { // DW_OP_consts
                const [value, len] = readSLEB128(expression, cursor); cursor += len;
                push(stack, value);
                break;
            }
            case 0x23: { // DW_OP_plus_uconst
                const [value, len] = readULEB128(expression, cursor); cursor += len;
                const top = pop(stack);
                if (top === undefined) { return underflow(); }
                push(stack, top + value);
                break;
            }
            case 0x91: { // DW_OP_fbreg
                const [offset, len] = readSLEB128(expression, cursor); cursor += len;
                push(stack, context.frameBase + offset);
                break;
            }
            case 0x9C: // DW_OP_call_frame_cfa
                push(stack, context.cfa);
                break;
            case 0x9F: // DW_OP_stack_value
                isValue = true;
                break;
            default:
                return { kind: 'unavailable', reason: `unsupported DW_OP 0x${op.toString(16)}` };
        }
    }

    if (registerResult !== undefined) { return { kind: 'register', register: registerResult }; }
    const top = stack.pop();
    if (top === undefined) { return { kind: 'unavailable', reason: 'empty expression stack' }; }
    return isValue ? { kind: 'value', value: top } : { kind: 'memory', address: top & 0xFFFF };
}

function push(stack: number[], value: number): boolean {
    if (stack.length >= MAX_STACK) { return false; }
    stack.push(value | 0);
    return true;
}

function pop(stack: number[]): number | undefined {
    return stack.pop();
}

function binary(stack: number[], fn: (a: number, b: number) => number): EvaluatedLocation | undefined {
    const b = pop(stack); const a = pop(stack);
    if (a === undefined || b === undefined) { return underflow(); }
    push(stack, fn(a, b));
    return undefined;
}

function underflow(): EvaluatedLocation {
    return { kind: 'unavailable', reason: 'expression stack underflow' };
}
