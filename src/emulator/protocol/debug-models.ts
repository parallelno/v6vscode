/** Typed models for the structured v6emul debug IPC protocol. */

/** Mask for all addressable pages: bit 0 = RAM, bits 1–32 = 8 × 4 RAM-disk pages. */
export const BP_ALL_PAGES = 8589934591; // 0x1_FFFF_FFFF (33 bits)

export type DebugCondition = 'ANY' | 'EQU' | 'LESS' | 'GREATER' | 'LESS_EQU' | 'GREATER_EQU' | 'NOT_EQU';
export type BreakpointStatus = 'ACTIVE' | 'DISABLED';
export type BreakpointStatusResult = BreakpointStatus | 'DELETED';
export type BreakpointOperand = 'A' | 'F' | 'B' | 'C' | 'D' | 'E' | 'H' | 'L'
    | 'PSW' | 'BC' | 'DE' | 'HL' | 'CC' | 'SP';

/** Payload for DEBUG_BREAKPOINT_ADD (command 60). */
export interface BreakpointAddRequest {
    addr: number;
    memPages: number;
    status: BreakpointStatus;
    autoDelete: boolean;
    operand: BreakpointOperand;
    condition: DebugCondition;
    value: number;
    comment: string;
}

/** Build a DEBUG_BREAKPOINT_ADD request for a standard active breakpoint. */
export function makeBreakpointAdd(addr: number, comment: string, autoDel = false): BreakpointAddRequest {
    return {
        addr,
        memPages: BP_ALL_PAGES,
        status: 'ACTIVE',
        autoDelete: autoDel,
        operand: 'A',
        condition: 'ANY',
        value: 0,
        comment,
    };
}

/** Entry returned in the DEBUG_BREAKPOINT_GET_ALL (command 67) response array. */
export interface BreakpointEntry {
    addr: number;
    memPages: number;
    status: BreakpointStatus;
    autoDelete: boolean;
    operand: BreakpointOperand;
    condition: DebugCondition;
    value: number;
    comment: string;
}

/** Payload for DEBUG_BREAKPOINT_DEL (command 61). */
export interface BreakpointDelRequest {
    addr: number;
}

/** Response from DEBUG_BREAKPOINT_GET_STATUS (command 63). */
export interface BreakpointGetStatusResponse {
    status: BreakpointStatusResult;
}

export type WatchpointAccess = 'R' | 'W' | 'RW';
export type WatchpointType = 'LEN' | 'WORD';

/** Payload for DEBUG_WATCHPOINT_ADD (command 69). */
export interface WatchpointAddRequest {
    globalAddr: number;
    len: number;
    value: number;
    access: WatchpointAccess;
    condition: DebugCondition;
    type: WatchpointType;
    active: boolean;
    comment: string;
}

/** Payload for DEBUG_WATCHPOINT_EDIT (command 94). */
export interface WatchpointEditRequest extends WatchpointAddRequest {
    id: number;
}

/** Entry returned by DEBUG_WATCHPOINT_GET_ALL (command 73). */
export type WatchpointEntry = WatchpointEditRequest;

/** Payload for DEBUG_WATCHPOINT_DEL (command 71). */
export interface WatchpointDelRequest {
    id: number;
}

// ---------------------------------------------------------------------------
// Stop detection
// ---------------------------------------------------------------------------

export type StopReason = 'pause' | 'breakpoint' | 'data breakpoint' | 'step' | 'entry' | 'exception' | 'unknown';
export type EmulatorStopReason = 'pause' | 'breakpoint' | 'watchpoint' | 'step' | 'next' | 'frameStep'
    | 'exception' | 'unknown';
export type StopRecordAccess = 'read' | 'write';

export interface StopRecord {
    sequence: number;
    reason: EmulatorStopReason;
    pc: number;
    globalInstructionAddress: number;
    breakpointIds?: number[];
    breakpointAddress?: number;
    watchpointIds?: number[];
    access?: StopRecordAccess;
    accessedGlobalAddress?: number;
    observedValue?: number;
    oldValue?: number;
    newValue?: number;
    exceptionCode?: number | string;
    description?: string;
}

export function decodeStopRecord(value: unknown): StopRecord {
    if (!isObject(value)) { throw new Error('Invalid stop record: expected an object'); }
    const reason = value.reason;
    const reasons: EmulatorStopReason[] = [
        'pause', 'breakpoint', 'watchpoint', 'step', 'next', 'frameStep', 'exception', 'unknown',
    ];
    if (typeof reason !== 'string' || !reasons.includes(reason as EmulatorStopReason)) {
        throw new Error('Invalid stop record: reason is invalid');
    }

    const record: StopRecord = {
        sequence: requiredInteger(value, 'sequence', 0, Number.MAX_SAFE_INTEGER),
        reason: reason as EmulatorStopReason,
        pc: requiredInteger(value, 'pc', 0, 0xFFFF),
        globalInstructionAddress: requiredInteger(value, 'globalInstructionAddress', 0, Number.MAX_SAFE_INTEGER),
    };
    assignIntegerArray(value, record, 'breakpointIds');
    assignOptionalInteger(value, record, 'breakpointAddress');
    assignIntegerArray(value, record, 'watchpointIds');
    if (value.access !== undefined) {
        if (value.access !== 'read' && value.access !== 'write') {
            throw new Error('Invalid stop record: access is invalid');
        }
        record.access = value.access;
    }
    for (const field of ['accessedGlobalAddress', 'observedValue', 'oldValue', 'newValue'] as const) {
        assignOptionalInteger(value, record, field);
    }
    if (value.exceptionCode !== undefined) {
        if ((typeof value.exceptionCode !== 'string' || value.exceptionCode.length > 256)
            && !isIntegerInRange(value.exceptionCode, 0, Number.MAX_SAFE_INTEGER)) {
            throw new Error('Invalid stop record: exceptionCode is invalid');
        }
        record.exceptionCode = value.exceptionCode as number | string;
    }
    if (value.description !== undefined) {
        if (typeof value.description !== 'string' || value.description.length > 4096) {
            throw new Error('Invalid stop record: description is invalid');
        }
        record.description = value.description;
    }
    return record;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
    return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

function requiredInteger(value: Record<string, unknown>, field: string, min: number, max: number): number {
    if (!isIntegerInRange(value[field], min, max)) {
        throw new Error(`Invalid stop record: ${field} is invalid`);
    }
    return value[field];
}

function assignOptionalInteger<K extends keyof StopRecord>(
    source: Record<string, unknown>, target: StopRecord, field: K,
): void {
    const value = source[field as string];
    if (value === undefined) { return; }
    if (!isIntegerInRange(value, 0, Number.MAX_SAFE_INTEGER)) {
        throw new Error(`Invalid stop record: ${String(field)} is invalid`);
    }
    (target as any)[field] = value;
}

function assignIntegerArray<K extends 'breakpointIds' | 'watchpointIds'>(
    source: Record<string, unknown>, target: StopRecord, field: K,
): void {
    const value = source[field];
    if (value === undefined) { return; }
    if (!Array.isArray(value) || !value.every(item => isIntegerInRange(item, 0, Number.MAX_SAFE_INTEGER))) {
        throw new Error(`Invalid stop record: ${field} is invalid`);
    }
    target[field] = [...value];
}

/** IS_RUNNING (command 3) response. */
export interface IsRunningResponse {
    isRunning: boolean;
}

/** GET_STEP_OVER_ADDR (command 28) response. */
export interface GetStepOverAddrResponse {
    addr: number;
}

/** GET_STACK_SAMPLE (command 18) response. */
export interface GetStackSampleResponse {
    '-10': number;
    '-8': number;
    '-6': number;
    '-4': number;
    '-2': number;
    '0': number;
    '2': number;
    '4': number;
    '6': number;
    '8': number;
    '10': number;
}
