import { TraceLogFilterRequest } from '../../emulator/protocol/ipc-commands';

export type TraceLogQueryResult =
    | { ok: true; request: TraceLogFilterRequest }
    | { ok: false; error: string };

export function parseTraceLogQuery(input: string, maxPatternBytes: number): TraceLogQueryResult {
    const query = input.trim();
    if (!query) { return { ok: true, request: {} }; }

    const separator = query.search(/\s/);
    const addressPattern = separator < 0 ? query : query.slice(0, separator);
    const instructionPattern = separator < 0 ? '' : query.slice(separator).trim();
    if (addressPattern !== '*' && !/^0x[0-9a-f*]+$/i.test(addressPattern)) {
        return { ok: false, error: 'Address pattern must be * or a 0x-prefixed hexadecimal glob' };
    }
    if (Buffer.byteLength(addressPattern, 'utf8') > maxPatternBytes) {
        return { ok: false, error: `Address pattern exceeds ${maxPatternBytes} UTF-8 bytes` };
    }
    if (Buffer.byteLength(instructionPattern, 'utf8') > maxPatternBytes) {
        return { ok: false, error: `Instruction pattern exceeds ${maxPatternBytes} UTF-8 bytes` };
    }

    return {
        ok: true,
        request: {
            ...(addressPattern === '*' ? {} : { addressPattern }),
            ...(instructionPattern ? { instructionPattern } : {}),
        },
    };
}