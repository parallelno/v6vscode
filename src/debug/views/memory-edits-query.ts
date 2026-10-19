import { parseIntegerLiteral } from '../../shared/numbers';

export type ParsedMemoryEditQuery =
    | { kind: 'empty' }
    | { kind: 'value'; value: number }
    | { kind: 'invalid'; message: string };

export function parseMemoryEditQuery(input: string): ParsedMemoryEditQuery {
    const text = input.trim();
    if (!text) { return { kind: 'empty' }; }
    const value = parseIntegerLiteral(text);
    if (value === undefined) {
        return { kind: 'invalid', message: 'Enter a byte as decimal, $NN, 0xNN, or NNh' };
    }
    return value <= 0xFF
        ? { kind: 'value', value }
        : { kind: 'invalid', message: 'Byte value must be in the range 0..255' };
}