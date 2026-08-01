export type ParsedLocation =
    | { kind: 'address'; value: number }
    | { kind: 'symbol'; name: string };

export type ParsedHexQuery =
    | { kind: 'empty' }
    | { kind: 'invalid'; message: string }
    | { kind: 'location'; location: ParsedLocation }
    | { kind: 'range'; start: ParsedLocation; end: ParsedLocation };

const SYMBOL_PATTERN = /^[A-Za-z_.@][A-Za-z0-9_.@$]*$/;

export function parseHexQuery(input: string): ParsedHexQuery {
    const query = input.trim();
    if (!query) {
        return { kind: 'empty' };
    }

    const delimiter = query.includes('..') ? '..' : '-';
    const parts = query.split(delimiter);
    if (parts.length > 2) {
        return { kind: 'invalid', message: `A range may contain only one "${delimiter}" delimiter` };
    }

    const start = parseLocation(parts[0].trim());
    if (typeof start === 'string') {
        return { kind: 'invalid', message: start };
    }
    if (parts.length === 1) {
        return { kind: 'location', location: start };
    }

    const end = parseLocation(parts[1].trim());
    if (typeof end === 'string') {
        return { kind: 'invalid', message: end };
    }
    if (start.kind === 'address' && end.kind === 'address' && start.value > end.value) {
        return { kind: 'invalid', message: 'Range start must not exceed range end' };
    }
    return { kind: 'range', start, end };
}

function parseLocation(input: string): ParsedLocation | string {
    if (!input) {
        return 'Address or symbol is required';
    }

    let value: number | undefined;
    if (/^[0-9]+$/.test(input)) {
        value = Number.parseInt(input, 10);
    } else if (/^0x[0-9a-f]+$/i.test(input)) {
        value = Number.parseInt(input.slice(2), 16);
    } else if (/^[0-9a-f]+h$/i.test(input)) {
        value = Number.parseInt(input.slice(0, -1), 16);
    } else if (/^\$[0-9a-f]+$/i.test(input)) {
        value = Number.parseInt(input.slice(1), 16);
    } else if (SYMBOL_PATTERN.test(input)) {
        return { kind: 'symbol', name: input };
    } else {
        return `Invalid address or symbol: ${input}`;
    }

    return value <= 0xFFFF
        ? { kind: 'address', value }
        : `Address is outside 0x0000..0xFFFF: ${input}`;
}