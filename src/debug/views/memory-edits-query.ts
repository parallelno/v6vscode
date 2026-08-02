export type ParsedMemoryEditQuery =
    | { kind: 'empty' }
    | { kind: 'value'; value: number }
    | { kind: 'invalid'; message: string };

export function parseMemoryEditQuery(input: string): ParsedMemoryEditQuery {
    const text = input.trim();
    if (!text) { return { kind: 'empty' }; }
    let value: number;
    if (/^[0-9]+$/.test(text)) {
        value = Number.parseInt(text, 10);
    } else if (/^\$[0-9a-f]+$/i.test(text)) {
        value = Number.parseInt(text.slice(1), 16);
    } else if (/^0x[0-9a-f]+$/i.test(text)) {
        value = Number.parseInt(text.slice(2), 16);
    } else if (/^[0-9a-f]+h$/i.test(text)) {
        value = Number.parseInt(text.slice(0, -1), 16);
    } else {
        return { kind: 'invalid', message: 'Enter a byte as decimal, $NN, 0xNN, or NNh' };
    }
    return value <= 0xFF
        ? { kind: 'value', value }
        : { kind: 'invalid', message: 'Byte value must be in the range 0..255' };
}