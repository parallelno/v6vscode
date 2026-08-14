import {
    ScriptOverlayItem,
    ScriptOverlayLimits,
    ScriptOverlayResponse,
} from '../../emulator/protocol/debug-models';

export function decodeScriptOverlayResponse(value: unknown, limits: ScriptOverlayLimits): ScriptOverlayResponse {
    const record = object(value, 'Script overlay response');
    exactFields(record, new Set(['overlays']), 'Script overlay response');
    if (!Array.isArray(record.overlays)) { throw new Error('overlays must be an array'); }
    if (record.overlays.length > limits.maxItemsTotal) { throw new Error('overlays exceeds maxItemsTotal'); }
    const overlays = record.overlays.map(item => decodeOverlay(item, limits));
    const perScriptCount = new Map<number, number>();
    for (let index = 0; index < overlays.length; index++) {
        const overlay = overlays[index];
        const count = (perScriptCount.get(overlay.scriptId) ?? 0) + 1;
        if (count > limits.maxItemsPerScript) { throw new Error('overlays exceeds maxItemsPerScript'); }
        perScriptCount.set(overlay.scriptId, count);
        if (index > 0 && compare(overlays[index - 1], overlay) >= 0) {
            throw new Error('Script overlays must be ordered by unique scriptId and itemId');
        }
    }
    return { overlays };
}

function decodeOverlay(value: unknown, limits: ScriptOverlayLimits): ScriptOverlayItem {
    const record = object(value, 'Script overlay');
    const common = {
        scriptId: integer(record.scriptId, 'scriptId', 0, 0x7FFFFFFF),
        itemId: integer(record.itemId, 'itemId', 0, 0x7FFFFFFF),
        vectorScreenCoords: boolean(record.vectorScreenCoords, 'vectorScreenCoords'),
        x: integer(record.x, 'x', -limits.maxCoordinateMagnitude, limits.maxCoordinateMagnitude),
        y: integer(record.y, 'y', -limits.maxCoordinateMagnitude, limits.maxCoordinateMagnitude),
        color: integer(record.color, 'color', 0, 0xFFFFFFFF),
    };
    if (record.type === 'text') {
        exactFields(record, new Set(['scriptId', 'itemId', 'vectorScreenCoords', 'x', 'y', 'color', 'type', 'text']), 'Text overlay');
        return { ...common, type: 'text', text: utf8String(record.text, 'text', limits.maxTextBytes) };
    }
    if (record.type === 'rect') {
        exactFields(record, new Set([
            'scriptId', 'itemId', 'vectorScreenCoords', 'x', 'y', 'color', 'type', 'width', 'height', 'filled',
        ]), 'Rectangle overlay');
        return {
            ...common,
            type: 'rect',
            width: integer(record.width, 'width', 0, limits.maxCoordinateMagnitude),
            height: integer(record.height, 'height', 0, limits.maxCoordinateMagnitude),
            filled: boolean(record.filled, 'filled'),
        };
    }
    throw new Error('Script overlay type must be text or rect');
}

function compare(left: ScriptOverlayItem, right: ScriptOverlayItem): number {
    return left.scriptId - right.scriptId || left.itemId - right.itemId;
}

function object(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${name} must be an object`);
    }
    return value as Record<string, unknown>;
}

function exactFields(record: Record<string, unknown>, allowed: Set<string>, name: string): void {
    const unknown = Object.keys(record).find(field => !allowed.has(field));
    if (unknown) { throw new Error(`Unknown ${name} field: ${unknown}`); }
    const missing = [...allowed].find(field => !(field in record));
    if (missing) { throw new Error(`Missing ${name} field: ${missing}`); }
}

function integer(value: unknown, name: string, min: number, max: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
        throw new Error(`${name} must be an integer in ${min}..${max}`);
    }
    return value as number;
}

function boolean(value: unknown, name: string): boolean {
    if (typeof value !== 'boolean') { throw new Error(`${name} must be a boolean`); }
    return value;
}

function utf8String(value: unknown, name: string, maxBytes: number): string {
    if (typeof value !== 'string' || value.includes('\0')) { throw new Error(`${name} must be a non-NUL string`); }
    if (Buffer.byteLength(value, 'utf8') > maxBytes) { throw new Error(`${name} exceeds ${maxBytes} UTF-8 bytes`); }
    return value;
}