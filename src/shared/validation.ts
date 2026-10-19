/** Structured user-input failures. Wire decoders are contextualized at the protocol boundary. */
export class ValidationError extends Error {
    readonly name = 'ValidationError';
    constructor(readonly field: string, message: string, readonly reason = 'invalid', readonly cause?: unknown) {
        super(message);
    }
}

export function expectRecord(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ValidationError(name, `${name} must be an object`, 'type');
    }
    return value as Record<string, unknown>;
}

export function expectInteger(value: unknown, name: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
        throw new ValidationError(name, `${name} must be an integer in ${min}..${max}`, 'range');
    }
    return value as number;
}

export function expectFiniteNumber(value: unknown, name: string, min: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
        throw new ValidationError(name, `${name} must be a finite number greater than or equal to ${min}`, 'range');
    }
    return value;
}

export function expectBoolean(value: unknown, name: string): boolean {
    if (typeof value !== 'boolean') { throw new ValidationError(name, `${name} must be a boolean`, 'type'); }
    return value;
}

/** Browser-safe UTF-8 measurement: no Node Buffer dependency. */
export function expectUtf8String(value: unknown, name: string, maxBytes: number): string {
    if (typeof value !== 'string') { throw new ValidationError(name, `${name} must be a string`, 'type'); }
    if (new TextEncoder().encode(value).length > maxBytes) {
        throw new ValidationError(name, `${name} exceeds ${maxBytes} UTF-8 bytes`, 'length');
    }
    return value;
}

export function expectFields(record: Record<string, unknown>, allowed: ReadonlySet<string>, name: string, required = true): void {
    const unknown = Object.keys(record).find(field => !allowed.has(field));
    if (unknown !== undefined) { throw new ValidationError(unknown, `Unknown ${name} field: ${unknown}`, 'unknown'); }
    const missing = required ? [...allowed].find(field => !Object.prototype.hasOwnProperty.call(record, field)) : undefined;
    if (missing !== undefined) { throw new ValidationError(missing, `Missing ${name} field: ${missing}`, 'missing'); }
}

export function expectArray(value: unknown, name: string, maxLength = Number.MAX_SAFE_INTEGER): unknown[] {
    if (!Array.isArray(value)) { throw new ValidationError(name, `${name} must be an array`, 'type'); }
    if (value.length > maxLength) { throw new ValidationError(name, `${name} exceeds maxRecords`, 'length'); }
    return value;
}

/** Serializable diagnostics shared with browser message contracts. */
export interface ErrorDiagnostic {
    kind: 'input' | 'remote' | 'malformed';
    command?: number;
    code?: string;
    field?: string;
    reason?: string;
}
