/**
 * Mask double-quoted text and stop at an unquoted ';'. Preserve UTF-16 offsets
 * used by VS Code. This intentionally retains the existing quote-toggle dialect;
 * it is not a replacement for the full TextMate assembler grammar.
 */
export function codeBeforeComment(line: string): string {
    let quoted = false;
    let result = '';
    for (let index = 0; index < line.length; index++) {
        const character = line[index];
        if (character === '"') { quoted = !quoted; result += ' '; continue; }
        if (!quoted && character === ';') { break; }
        result += quoted ? ' ' : character;
    }
    return result;
}