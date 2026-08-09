import {
    ScriptCollectionResponse,
    ScriptCompilation,
    ScriptInput,
    ScriptLimits,
    ScriptMutationResponse,
    ScriptRuntime,
    ScriptRunOnceResponse,
    ScriptSnapshot,
} from '../../emulator/protocol/debug-models';

export function validateScriptInput(value: unknown, limits: ScriptLimits): ScriptInput {
    const record = object(value, 'Script input');
    exactFields(record, new Set(['name', 'path', 'active']), 'Script input');
    const name = utf8String(record.name, 'name', limits.maxNameBytes);
    if (!name.length) { throw new Error('name must not be empty'); }
    const path = utf8String(record.path, 'path', limits.maxPathBytes);
    if (!isAbsoluteWirePath(path)) { throw new Error('path must be an absolute generic path'); }
    return { name, path, active: boolean(record.active, 'active') };
}

export function decodeScriptSnapshot(value: unknown, limits: ScriptLimits): ScriptSnapshot {
    const record = object(value, 'Script snapshot');
    exactFields(record, new Set([
        'scriptId', 'name', 'path', 'active', 'compilation', 'runtime',
    ]), 'Script snapshot');
    return {
        scriptId: integer(record.scriptId, 'scriptId', 0, 0x7FFFFFFF),
        ...validateScriptInput({ name: record.name, path: record.path, active: record.active }, limits),
        compilation: decodeCompilation(record.compilation, limits),
        runtime: decodeRuntime(record.runtime, limits),
    };
}

export function decodeScriptMutationResponse(value: unknown, limits: ScriptLimits): ScriptMutationResponse {
    const record = object(value, 'Script mutation response');
    exactFields(record, new Set(['updates', 'script']), 'Script mutation response');
    return {
        updates: uint32(record.updates, 'updates'),
        script: decodeScriptSnapshot(record.script, limits),
    };
}

export function decodeScriptCollectionResponse(value: unknown, limits: ScriptLimits): ScriptCollectionResponse {
    const record = object(value, 'Script collection response');
    exactFields(record, new Set(['updates', 'scripts']), 'Script collection response');
    if (!Array.isArray(record.scripts)) { throw new Error('scripts must be an array'); }
    if (record.scripts.length > limits.maxRecords) { throw new Error('scripts exceeds maxRecords'); }
    const scripts = record.scripts.map(entry => decodeScriptSnapshot(entry, limits));
    for (let index = 1; index < scripts.length; index++) {
        if (scripts[index - 1].scriptId >= scripts[index].scriptId) {
            throw new Error('Script snapshots must be ordered by unique scriptId');
        }
    }
    return { updates: uint32(record.updates, 'updates'), scripts };
}

export function decodeScriptRunOnceResponse(value: unknown, limits: ScriptLimits): ScriptRunOnceResponse {
    const record = object(value, 'Script Run Once response');
    const allowed = new Set(['scriptId', 'succeeded', 'breakRequested', 'updates', 'runtime', 'error']);
    exactFields(record, allowed, 'Script Run Once response', new Set(['error']));
    const succeeded = boolean(record.succeeded, 'succeeded');
    const runtime = decodeRuntime(record.runtime, limits);
    const error = record.error === undefined ? undefined : utf8String(record.error, 'error', limits.maxErrorBytes);
    if (succeeded !== (runtime.status === 'succeeded')) {
        throw new Error('Run Once succeeded does not match runtime status');
    }
    if (!succeeded && runtime.status !== 'error') {
        throw new Error('Failed Run Once must return runtime error state');
    }
    return {
        scriptId: integer(record.scriptId, 'scriptId', 0, 0x7FFFFFFF),
        succeeded,
        breakRequested: boolean(record.breakRequested, 'breakRequested'),
        updates: uint32(record.updates, 'updates'),
        runtime,
        ...(error === undefined ? {} : { error }),
    };
}

export function decodeScriptUpdates(value: unknown): number {
    const record = object(value, 'Script updates response');
    exactFields(record, new Set(['updates']), 'Script updates response');
    return uint32(record.updates, 'updates');
}

function decodeCompilation(value: unknown, limits: ScriptLimits): ScriptCompilation {
    const record = object(value, 'compilation');
    exactFields(record, new Set(['status', 'error']), 'compilation');
    if (record.status === 'compiled' && record.error === null) {
        return { status: 'compiled', error: null };
    }
    if (record.status === 'error') {
        return { status: 'error', error: utf8String(record.error, 'compilation.error', limits.maxErrorBytes) };
    }
    throw new Error('Invalid compilation state');
}

function decodeRuntime(value: unknown, limits: ScriptLimits): ScriptRuntime {
    const record = object(value, 'runtime');
    exactFields(record, new Set(['status', 'error']), 'runtime');
    if (record.status === 'never_run' && record.error === null) {
        return { status: 'never_run', error: null };
    }
    if (record.status === 'succeeded' && record.error === null) {
        return { status: 'succeeded', error: null };
    }
    if (record.status === 'error') {
        return { status: 'error', error: utf8String(record.error, 'runtime.error', limits.maxErrorBytes) };
    }
    throw new Error('Invalid runtime state');
}

function isAbsoluteWirePath(value: string): boolean {
    if (value.includes('\0')) { return false; }
    return /^[A-Za-z]:\//.test(value)
        || /^\/(?!\/)/.test(value)
        || /^\/\/[^/]+\/[^/]+(?:\/.*)?$/.test(value);
}

function object(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${name} must be an object`);
    }
    return value as Record<string, unknown>;
}

function exactFields(
    record: Record<string, unknown>,
    allowed: Set<string>,
    name: string,
    optional: Set<string> = new Set(),
): void {
    const unknown = Object.keys(record).find(field => !allowed.has(field));
    if (unknown) { throw new Error(`Unknown ${name} field: ${unknown}`); }
    const missing = [...allowed].find(field => !optional.has(field) && !(field in record));
    if (missing) { throw new Error(`Missing ${name} field: ${missing}`); }
}

function integer(value: unknown, name: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
        throw new Error(`${name} must be an integer in ${min}..${max}`);
    }
    return value as number;
}

function uint32(value: unknown, name: string): number {
    return integer(value, name, 0, 0xFFFFFFFF);
}

function boolean(value: unknown, name: string): boolean {
    if (typeof value !== 'boolean') { throw new Error(`${name} must be a boolean`); }
    return value;
}

function utf8String(value: unknown, name: string, maxBytes: number): string {
    if (typeof value !== 'string') { throw new Error(`${name} must be a string`); }
    if (Buffer.byteLength(value, 'utf8') > maxBytes) {
        throw new Error(`${name} exceeds ${maxBytes} UTF-8 bytes`);
    }
    return value;
}
