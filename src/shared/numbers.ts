/** Unsigned decimal or explicitly marked hex. Signs/operators belong to the expression dialect. */
export function parseIntegerLiteral(input: string): number | undefined {
    const text = input.trim();
    if (/^[0-9]+$/.test(text)) { return Number.parseInt(text, 10); }
    if (/^\$[0-9a-f]+$/i.test(text)) { return Number.parseInt(text.slice(1), 16); }
    if (/^0x[0-9a-f]+$/i.test(text)) { return Number.parseInt(text.slice(2), 16); }
    if (/^[0-9a-f]+h$/i.test(text)) { return Number.parseInt(text.slice(0, -1), 16); }
    return undefined;
}

/** Minimum digit width, not byte width. Never truncates; machine wrapping stays at the caller. */
export function formatHex(value: number, digits: number): string {
    if (!Number.isSafeInteger(value) || value < 0) { throw new RangeError('Hex value must be an unsigned safe integer'); }
    if (!Number.isSafeInteger(digits) || digits < 0 || digits > 64) { throw new RangeError('Hex digit width must be in 0..64'); }
    return `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`;
}