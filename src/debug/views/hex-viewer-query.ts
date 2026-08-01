import { bareSymbol, validateSymbolExpression } from '../utilities/symbol-expression';

export type ParsedLocation =
    | { kind: 'address'; value: number }
    | { kind: 'symbol'; name: string }
    | { kind: 'expression'; value: string };

export type ParsedHexQuery =
    | { kind: 'empty' }
    | { kind: 'invalid'; message: string }
    | { kind: 'location'; location: ParsedLocation }
    | { kind: 'range'; start: ParsedLocation; end: ParsedLocation };

const NUMERIC_LITERAL = '(?:[0-9]+|0x[0-9a-f]+|[0-9a-f]+h|\\$[0-9a-f]+)';
const LEGACY_RANGE_PATTERN = new RegExp(`^\\s*(${NUMERIC_LITERAL})\\s*-\\s*(${NUMERIC_LITERAL})\\s*$`, 'i');

export function parseHexQuery(input: string): ParsedHexQuery {
    const query = input.trim();
    if (!query) {
        return { kind: 'empty' };
    }

    const range = query.includes('..')
        ? query.split('..')
        : LEGACY_RANGE_PATTERN.exec(query)?.slice(1);
    if (range && range.length > 2) {
        return { kind: 'invalid', message: 'A range may contain only one ".." delimiter' };
    }

    const start = parseLocation((range?.[0] ?? query).trim());
    if (typeof start === 'string') {
        return { kind: 'invalid', message: start };
    }
    if (!range) {
        return { kind: 'location', location: start };
    }

    const end = parseLocation(range[1].trim());
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
    } else if (bareSymbol(input)) {
        return { kind: 'symbol', name: input };
    } else {
        const error = validateSymbolExpression(input);
        return error ?? { kind: 'expression', value: input };
    }

    return value <= 0xFFFF
        ? { kind: 'address', value }
        : `Address is outside 0x0000..0xFFFF: ${input}`;
}