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

/**
 * Stop reason classification.
 * The current backend (Step 3.2) only exposes IS_RUNNING transitions.
 * Structured stop info (Step 3.3) will make this more precise.
 */
export type StopReason = 'pause' | 'breakpoint' | 'step' | 'entry' | 'unknown';

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
