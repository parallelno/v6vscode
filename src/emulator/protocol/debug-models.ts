/**
 * Typed models and encoding helpers for the v6emul debug IPC protocol.
 *
 * Breakpoint wire format (Breakpoint::DataStruct in breakpoint.h, #pragma pack(push,1)):
 *
 *   data0 (uint64) = MemPages mask — one bit per addressable page.
 *                    Use BP_ALL_PAGES (0x1_FFFF_FFFF) for page-independent breakpoints.
 *   data1 (uint64) = value — comparison target for conditional breakpoints (0 for ANY).
 *   data2 (uint32) bit layout:
 *     bits  0–15: addr    (16-bit CPU address)
 *     bits 16–19: operand (4 bits, OPERAND_BIT_WIDTH=4)
 *                 0=A, 1=Flags, 2=B, 3=C, 4=D, 5=E, 6=H, 7=L,
 *                 8=PSW, 9=BC, 10=DE, 11=HL, 12=CC, 13=SP
 *     bits 20–23: cond    (4 bits, CONDITION_BIT_WIDTH+1=4)
 *                 0=ANY, 1=EQU, 2=LESS, 3=GREATER, 4=LESS_EQU, 5=GREATER_EQU, 6=NOT_EQU
 *     bits 24–25: status  (2 bits, STATUS_BIT_WIDTH=2)
 *                 0=DISABLED, 1=ACTIVE, 2=DELETED
 *     bit  26:    autoDel (bool — backend auto-removes on hit)
 *
 * Verified by live round-trip on 2026-07-29: status=0 (DISABLED) when bits 24–25 are zero.
 * Active breakpoints require status=1 → bit 24 must be set.
 */

// ---------------------------------------------------------------------------
// MemPages constant
// ---------------------------------------------------------------------------

/** Mask for all addressable pages: bit 0 = RAM, bits 1–32 = 8 × 4 RAM-disk pages. */
export const BP_ALL_PAGES = 8589934591; // 0x1_FFFF_FFFF (33 bits)

// ---------------------------------------------------------------------------
// Status, operand, condition constants
// ---------------------------------------------------------------------------

export const BP_STATUS_DISABLED = 0;
export const BP_STATUS_ACTIVE = 1;
export const BP_STATUS_DELETED = 2;

export const BP_OPERAND_A = 0;
export const BP_COND_ANY = 0;

// ---------------------------------------------------------------------------
// data2 encoding / decoding
// ---------------------------------------------------------------------------

/**
 * Encode the data2 field of Breakpoint::DataStruct.
 *
 * @param addr    16-bit CPU address.
 * @param status  BP_STATUS_* constant (default: ACTIVE).
 * @param operand Operand to compare (default: A = 0).
 * @param cond    Condition (default: ANY = 0).
 * @param autoDel Backend auto-deletes the breakpoint on first hit when true.
 */
export function encodeBpData2(
    addr: number,
    status = BP_STATUS_ACTIVE,
    operand = BP_OPERAND_A,
    cond = BP_COND_ANY,
    autoDel = false,
): number {
    return (addr & 0xFFFF)
        | ((operand & 0xF) << 16)
        | ((cond & 0xF) << 20)
        | ((status & 0x3) << 24)
        | (autoDel ? (1 << 26) : 0);
}

/** Extract the 16-bit CPU address from a packed data2 value. */
export function decodeBpAddr(data2: number): number {
    return data2 & 0xFFFF;
}

/** Extract the status from a packed data2 value. */
export function decodeBpStatus(data2: number): number {
    return (data2 >>> 24) & 0x3;
}

/** Return true when a packed data2 value encodes an active breakpoint. */
export function isBpActive(data2: number): boolean {
    return decodeBpStatus(data2) === BP_STATUS_ACTIVE;
}

// ---------------------------------------------------------------------------
// Request / response shapes
// ---------------------------------------------------------------------------

/** Payload for DEBUG_BREAKPOINT_ADD (command 60). */
export interface BreakpointAddRequest {
    data0: number;   // memPages
    data1: number;   // value
    data2: number;   // packed bitfields (see above)
    comment: string;
}

/** Build a DEBUG_BREAKPOINT_ADD request for a standard active breakpoint. */
export function makeBreakpointAdd(addr: number, comment: string, autoDel = false): BreakpointAddRequest {
    return {
        data0: BP_ALL_PAGES,
        data1: 0,
        data2: encodeBpData2(addr, BP_STATUS_ACTIVE, BP_OPERAND_A, BP_COND_ANY, autoDel),
        comment,
    };
}

/** Entry returned in the DEBUG_BREAKPOINT_GET_ALL (command 67) response array. */
export interface BreakpointEntry {
    data0: number;
    data1: number;
    data2: number;
    comment: string;
}

/** Payload for DEBUG_BREAKPOINT_DEL (command 61). */
export interface BreakpointDelRequest {
    addr: number;
}

/** Response from DEBUG_BREAKPOINT_GET_STATUS (command 63). */
export interface BreakpointGetStatusResponse {
    status: number;
}

// ---------------------------------------------------------------------------
// Watchpoint — Watchpoint::Data (watchpoint.h)
//
// data0 (uint64): globalAddr (uint32) | id (int32)
// data1 (uint64): len (uint32) | value (uint16) | access (2 bits) |
//                 cond (4 bits) | type (2 bits) | active (1) | breakL (1) | breakH (1)
// ---------------------------------------------------------------------------

export const WP_ACCESS_R = 0;
export const WP_ACCESS_W = 1;
export const WP_ACCESS_RW = 2;

export const WP_TYPE_LEN = 0;
export const WP_TYPE_WORD = 1;

/** Payload for DEBUG_WATCHPOINT_ADD (command 69). */
export interface WatchpointAddRequest {
    data0: number;
    data1: number;
    comment: string;
}

/** Entry returned by DEBUG_WATCHPOINT_GET_ALL (command 73). */
export interface WatchpointEntry {
    data0: number;
    data1: number;
    comment: string;
}

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
    data: number[];
}
