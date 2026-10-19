import { IpcCommand, IpcResponse } from './ipc-commands';
import { expectRecord, ValidationError, ErrorDiagnostic } from '../../shared/validation';

/** Retains server diagnostics independently of user-facing wording. Never implies safe replay. */
export class ProtocolError extends Error {
    readonly name = 'ProtocolError';
    readonly retryable = false;
    constructor(
        readonly command: IpcCommand,
        message: string,
        readonly kind: 'remote' | 'malformed',
        readonly code?: string,
        readonly details?: Readonly<Record<string, unknown>>,
        readonly cause?: unknown,
    ) { super(message); }

    get field(): string | undefined { return typeof this.details?.field === 'string' ? this.details.field : undefined; }
    get reason(): string | undefined { return typeof this.details?.reason === 'string' ? this.details.reason : undefined; }
}

function malformed(command: IpcCommand, fallback: string, cause: unknown): ProtocolError {
    const message = cause instanceof Error ? cause.message : String(cause);
    const details = cause instanceof ValidationError ? { field: cause.field, reason: cause.reason } : undefined;
    return new ProtocolError(command, `${fallback}: ${message}`, 'malformed', undefined, details, cause);
}

/** Validate the envelope even when a caller's generic send<T> claimed it was typed. */
export function requireProtocolOk(command: IpcCommand, value: unknown, fallback: string): IpcResponse<unknown> {
    let record: Record<string, unknown>;
    try {
        record = expectRecord(value, 'IPC response');
        if (typeof record.ok !== 'boolean') { throw new ValidationError('ok', 'IPC response ok must be a boolean', 'type'); }
        if (record.error !== undefined && typeof record.error !== 'string') { throw new ValidationError('error', 'IPC response error must be a string', 'type'); }
        if (record.code !== undefined && typeof record.code !== 'string') { throw new ValidationError('code', 'IPC response code must be a string', 'type'); }
        if (record.details !== undefined) { expectRecord(record.details, 'details'); }
    } catch (error) { throw malformed(command, fallback, error); }
    if (!record.ok) {
        const details = record.details === undefined ? undefined : Object.freeze({ ...record.details as Record<string, unknown> });
        const base = typeof record.error === 'string' ? record.error : fallback;
        const field = typeof details?.field === 'string' ? ` (${details.field})` : '';
        const reason = typeof details?.reason === 'string' ? `: ${details.reason}` : '';
        throw new ProtocolError(command, `${base}${field}${reason}`, 'remote', record.code as string | undefined, details);
    }
    return record as unknown as IpcResponse<unknown>;
}

export function decodeProtocolData<T>(command: IpcCommand, response: unknown, fallback: string, decode: (data: unknown) => T): T {
    const envelope = requireProtocolOk(command, response, fallback);
    try {
        if (envelope.data === undefined) { throw new ValidationError('data', 'IPC response returned no data', 'missing'); }
        return decode(envelope.data);
    } catch (error) { throw malformed(command, fallback, error); }
}

export function diagnosticField(error: unknown): string | undefined {
    return error instanceof ProtocolError || error instanceof ValidationError ? error.field : undefined;
}

export function errorDiagnostic(error: unknown): ErrorDiagnostic | undefined {
    if (error instanceof ProtocolError) {
        return { kind: error.kind, command: error.command, code: error.code, field: error.field, reason: error.reason };
    }
    if (error instanceof ValidationError) { return { kind: 'input', field: error.field, reason: error.reason }; }
    return undefined;
}
