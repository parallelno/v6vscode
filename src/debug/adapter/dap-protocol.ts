import type { RequestedBreakpoint } from '../session/breakpoint-coordinator';

export interface DapArguments {
    source?: { path?: string; name?: string };
    breakpoints?: Array<RequestedBreakpoint & { dataId?: string; accessType?: string }>;
    frameId?: number;
    startFrame?: number;
    levels?: number;
    variablesReference?: number;
    start?: number;
    count?: number;
    granularity?: string;
    expression?: string;
    context?: string;
    name?: string;
    terminateDebuggee?: boolean;
    program?: string;
    debugArtifact?: string;
    /** Internal context supplied by project configuration, not a launch override. */
    __v6SourceRoot?: string;
    loadAddress?: string;
    speed?: string;
    fddReadOnly?: boolean;
    stopOnEntry?: boolean;
    port?: number;
    host?: string;
}
export interface DapRequest { type: 'request'; seq: number; command: string; arguments?: DapArguments }
export interface DapResponse { type: 'response'; request_seq: number; success: boolean; command: string; message?: string; body: unknown }
export interface DapEvent { type: 'event'; event: string; body: unknown }
export interface DapStackFrame {
    id: number; name: string; instructionPointerReference: string; line: number; column: number;
    source?: { path: string; name: string; sourceReference: number };
}
export interface DapScope { name: string; variablesReference: number; expensive: boolean; presentationHint?: string }

/** The only untyped-input assertion; request arguments retain their documented shapes. */
export function dapRequest(value: unknown): DapRequest | undefined {
    if (!value || typeof value !== 'object') { return undefined; }
    const record = value as Record<string, unknown>;
    if (record.type !== 'request' || !Number.isSafeInteger(record.seq) || typeof record.command !== 'string') { return undefined; }
    if (record.arguments !== undefined && (!record.arguments || typeof record.arguments !== 'object' || Array.isArray(record.arguments))) { return undefined; }
    return value as DapRequest;
}