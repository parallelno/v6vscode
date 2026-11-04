/** Directive kinds whose operands name a file. */

export type DirectiveKind = 'include' | 'incbin' | 'filesize';

export interface DirectiveMatch {
    readonly kind: DirectiveKind;
    /** Operand after string escape decoding; used for file lookup. */
    readonly value: string;
    /** One-based line number of the directive. */
    readonly line: number;
    /** Zero-based UTF-16 offset of the first character inside the quotes. */
    readonly startChar: number;
    /** UTF-16 length of the quoted content, excluding the quotes. */
    readonly length: number;
}

const DIRECTIVE_KINDS = new Map<string, DirectiveKind>([
    ['INCLUDE', 'include'],
    ['INCBIN', 'incbin'],
    ['FILESIZE', 'filesize'],
]);

const ESCAPES = new Map<string, string>([
    ['n', '\n'],
    ['t', '\t'],
    ['r', '\r'],
    ['0', '\0'],
    ['\\', '\\'],
    ['"', '"'],
    ["'", "'"],
]);

interface StringLiteral {
    readonly value: string;
    /** UTF-16 length of the source text between the quotes. */
    readonly rawLength: number;
}

/**
 * Finds `.include`, `.incbin`, and `.filesize` operands outside comments and
 * strings. Directive names are case-insensitive and may follow a label or a
 * `.filesize` constant name. Only double-quoted, decodable, nonempty operands
 * produce a match.
 */
export function scanDirectives(text: string): DirectiveMatch[] {
    const matches: DirectiveMatch[] = [];
    let index = 0;
    let line = 0;
    let lineStart = 0;

    const advanceTo = (next: number): void => {
        const target = Math.max(next, index);
        for (let position = index; position < target; position++) {
            if (text[position] === '\n') {
                line++;
                lineStart = position + 1;
            }
        }
        index = target;
    };

    while (index < text.length) {
        const character = text[index];
        if (character === '\n') {
            advanceTo(index + 1);
            continue;
        }
        if (character === ';' || (character === '/' && text[index + 1] === '/')) {
            advanceTo(endOfLine(text, index));
            continue;
        }
        if (character === '/' && text[index + 1] === '*') {
            advanceTo(endOfBlockComment(text, index + 2));
            continue;
        }
        if (character === '"' || character === '\'') {
            advanceTo(endOfQuoted(text, index));
            continue;
        }
        if (character !== '.' || !startsDirective(text, index)) {
            advanceTo(index + 1);
            continue;
        }

        const name = readIdentifier(text, index + 1);
        const kind = DIRECTIVE_KINDS.get(name.toUpperCase());
        if (!kind) {
            advanceTo(index + 1 + name.length);
            continue;
        }
        const operandStart = skipBlanks(text, index + 1 + name.length);
        if (text[operandStart] !== '"') {
            advanceTo(operandStart);
            continue;
        }
        const literal = readStringLiteral(text, operandStart);
        if (!literal) {
            advanceTo(operandStart + 1);
            continue;
        }
        matches.push({
            kind,
            value: literal.value,
            line,
            startChar: operandStart + 1 - lineStart,
            length: literal.rawLength,
        });
        advanceTo(operandStart + literal.rawLength + 2);
    }

    return matches;
}

/** True when `.` begins a directive token rather than a member access. */
function startsDirective(text: string, index: number): boolean {
    const previous = text[index - 1];
    if (previous === undefined) {
        return true;
    }
    return !/[\w.]/.test(previous);
}

function readIdentifier(text: string, from: number): string {
    let end = from;
    while (end < text.length && /\w/.test(text[end])) {
        end++;
    }
    return text.slice(from, end);
}

function skipBlanks(text: string, from: number): number {
    let index = from;
    while (index < text.length && (text[index] === ' ' || text[index] === '\t')) {
        index++;
    }
    return index;
}

function endOfLine(text: string, from: number): number {
    const newline = text.indexOf('\n', from);
    return newline === -1 ? text.length : newline;
}

function endOfBlockComment(text: string, from: number): number {
    const end = text.indexOf('*/', from);
    return end === -1 ? text.length : end + 2;
}

function endOfQuoted(text: string, from: number): number {
    let index = from + 1;
    while (index < text.length && text[index] !== text[from] && text[index] !== '\n') {
        index += text[index] === '\\' ? 2 : 1;
    }
    return Math.min(index + 1, text.length);
}

/** Decodes a double-quoted literal, or returns undefined when it is unusable. */
function readStringLiteral(text: string, quoteIndex: number): StringLiteral | undefined {
    let value = '';
    let index = quoteIndex + 1;
    while (index < text.length) {
        const character = text[index];
        if (character === '"') {
            return value.length > 0 ? { value, rawLength: index - quoteIndex - 1 } : undefined;
        }
        if (character === '\n') {
            return undefined;
        }
        if (character === '\\') {
            const escape = ESCAPES.get(text[index + 1]);
            if (escape === undefined) {
                return undefined;
            }
            value += escape;
            index += 2;
            continue;
        }
        value += character;
        index++;
    }
    return undefined;
}
