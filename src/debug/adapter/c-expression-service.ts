import { TypeInfo } from '../metadata/dwarf-types';
import { TypedValue } from './variable-service';

export type CExpressionResolver = (name: string) => number | undefined | Promise<number | undefined>;

export interface ExpressionValue {
    value: TypedValue;
    name?: string;
}

export interface CExpressionContext {
    resolve(name: string): ExpressionValue | number | undefined | Promise<ExpressionValue | number | undefined>;
    read(type: TypeInfo, address: number): Promise<TypedValue>;
    resolveType(name: string): TypeInfo | undefined;
}

type UnaryOperator = '+' | '-' | '~' | '!' | '*' | '&';
type BinaryOperator =
    | '*' | '/' | '%' | '+' | '-' | '<<' | '>>' | '<' | '<=' | '>' | '>='
    | '==' | '!=' | '&' | '^' | '|' | '&&' | '||';

type Expression =
    | { kind: 'integer'; value: number }
    | { kind: 'identifier'; name: string }
    | { kind: 'unary'; operator: UnaryOperator; operand: Expression }
    | { kind: 'binary'; operator: BinaryOperator; left: Expression; right: Expression }
    | { kind: 'index'; object: Expression; index: Expression }
    | { kind: 'member'; object: Expression; name: string; throughPointer: boolean }
    | { kind: 'cast'; typeName: string; operand: Expression };

interface Token {
    kind: 'integer' | 'identifier' | 'operator' | 'leftParen' | 'rightParen' | 'leftBracket' | 'rightBracket' | 'dot' | 'arrow' | 'end';
    text: string;
    offset: number;
}

const MAX_INPUT_LENGTH = 4096;
const MAX_TOKENS = 512;
const MAX_PARSE_DEPTH = 64;
const OPERATORS = ['<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+', '-', '~', '!', '*', '/', '%', '<', '>', '&', '^', '|'];

const BINARY_PRECEDENCE: Readonly<Record<BinaryOperator, number>> = {
    '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
    '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8,
    '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};

/** Parses and evaluates bounded, read-only scalar C expressions. */
export class CExpressionService {
    async evaluate(input: string, resolve: CExpressionResolver): Promise<number> {
        if (input.length > MAX_INPUT_LENGTH) { throw new Error('Expression is too long'); }
        const parser = new Parser(new Lexer(input).tokens());
        return this.evaluateNode(parser.parse(), resolve);
    }

    async evaluateValue(input: string, context: CExpressionContext): Promise<ExpressionValue> {
        if (input.length > MAX_INPUT_LENGTH) { throw new Error('Expression is too long'); }
        const value = await this.evaluateTyped(new Parser(new Lexer(input).tokens()).parse(), context);
        return { value: value.typed ?? scalarTypedValue(typedScalar(value)) };
    }

    private async evaluateTyped(expression: Expression, context: CExpressionContext): Promise<TypedExpressionValue> {
        switch (expression.kind) {
            case 'integer': return typedScalarValue(expression.value);
            case 'identifier': {
                const resolved = await context.resolve(expression.name);
                if (resolved === undefined) { throw new Error(`Unknown identifier '${expression.name}'`); }
                return typeof resolved === 'number' ? typedScalarValue(resolved) : fromTypedValue(resolved.value, resolved.name ?? expression.name);
            }
            case 'unary': {
                const operand = await this.evaluateTyped(expression.operand, context);
                if (expression.operator === '&') {
                    if (operand.address === undefined) { throw new Error('Address-of requires an addressable value'); }
                    const type = context.resolveType(`${operand.type?.name ?? 'void'} *`);
                    return { scalar: operand.address, type, typed: type ? typedValue(operand.address, type) : scalarTypedValue(operand.address) };
                }
                if (expression.operator === '*') {
                    const pointer = operand.type && unwrap(operand.type);
                    const type = pointer?.kind === 'pointer' || pointer?.kind === 'reference' ? pointer.of : undefined;
                    if (!type) { throw new Error('Dereference requires a pointer value'); }
                    return this.read(context, type, typedAddress(typedScalar(operand)));
                }
                return typedScalarValue(evaluateUnary(expression.operator, typedScalar(operand)));
            }
            case 'binary': {
                const left = typedScalar(await this.evaluateTyped(expression.left, context));
                if (expression.operator === '&&') { return typedScalarValue(left === 0 ? 0 : typedScalar(await this.evaluateTyped(expression.right, context)) !== 0 ? 1 : 0); }
                if (expression.operator === '||') { return typedScalarValue(left !== 0 ? 1 : typedScalar(await this.evaluateTyped(expression.right, context)) !== 0 ? 1 : 0); }
                return typedScalarValue(evaluateBinary(expression.operator, left, typedScalar(await this.evaluateTyped(expression.right, context))));
            }
            case 'index': {
                const object = await this.evaluateTyped(expression.object, context);
                const type = object.type && unwrap(object.type);
                const element = type?.kind === 'array' ? type.of : type?.kind === 'pointer' || type?.kind === 'reference' ? type.of : undefined;
                const base = type?.kind === 'array' ? object.address : typedScalar(object);
                if (!element || base === undefined) { throw new Error('Indexing requires an array or pointer value'); }
                return this.read(context, element, typedAddress(base + typedScalar(await this.evaluateTyped(expression.index, context)) * element.byteSize));
            }
            case 'member': {
                const object = await this.evaluateTyped(expression.object, context);
                const objectType = object.type && unwrap(object.type);
                const aggregate = expression.throughPointer && (objectType?.kind === 'pointer' || objectType?.kind === 'reference') ? objectType.of && unwrap(objectType.of) : expression.throughPointer ? undefined : objectType;
                const base = expression.throughPointer ? typedScalar(object) : object.address;
                if (!aggregate || (aggregate.kind !== 'structure' && aggregate.kind !== 'union') || base === undefined) { throw new Error(`Member access '${expression.throughPointer ? '->' : '.'}' requires a structure or union`); }
                const member = aggregate.members?.find(candidate => candidate.name === expression.name);
                if (!member?.type) { throw new Error(`Unknown member '${expression.name}'`); }
                return this.read(context, member.type, typedAddress(base + member.offset));
            }
            case 'cast': {
                const type = context.resolveType(expression.typeName);
                if (!type) { throw new Error(`Unsupported cast type '${expression.typeName}'`); }
                const operand = typedScalar(await this.evaluateTyped(expression.operand, context));
                return { scalar: operand, type, typed: typedValue(operand, type) };
            }
        }
    }

    private async read(context: CExpressionContext, type: TypeInfo, address: number): Promise<TypedExpressionValue> {
        const value = await context.read(type, address);
        if (value.availability !== 'available') { throw new Error(`Pointer 0x${address.toString(16).padStart(4, '0').toUpperCase()} is outside readable memory`); }
        return fromTypedValue(value);
    }

    private async evaluateNode(expression: Expression, resolve: CExpressionResolver): Promise<number> {
        switch (expression.kind) {
            case 'integer': return expression.value;
            case 'identifier': {
                const value = await resolve(expression.name);
                if (value === undefined) { throw new Error(`Unknown identifier '${expression.name}'`); }
                return checked(value);
            }
            case 'unary': return evaluateUnary(expression.operator, await this.evaluateNode(expression.operand, resolve));
            case 'binary': {
                const left = await this.evaluateNode(expression.left, resolve);
                if (expression.operator === '&&') { return left === 0 ? 0 : (await this.evaluateNode(expression.right, resolve)) !== 0 ? 1 : 0; }
                if (expression.operator === '||') { return left !== 0 ? 1 : (await this.evaluateNode(expression.right, resolve)) !== 0 ? 1 : 0; }
                return evaluateBinary(expression.operator, left, await this.evaluateNode(expression.right, resolve));
            }
            case 'index': case 'member': case 'cast':
                throw new Error('Expression requires typed variable context');
        }
    }
}

class Lexer {
    private offset = 0;
    private tokenCount = 0;

    constructor(private readonly input: string) {}

    tokens(): Token[] {
        const tokens: Token[] = [];
        do {
            const token = this.next();
            tokens.push(token);
        } while (tokens[tokens.length - 1].kind !== 'end');
        return tokens;
    }

    private next(): Token {
        while (/\s/.test(this.input[this.offset] ?? '')) { this.offset++; }
        const start = this.offset;
        const char = this.input[this.offset];
        if (char === undefined) { return this.token('end', '', start); }
        if (char === '[') { this.offset++; return this.token('leftBracket', char, start); }
        if (char === ']') { this.offset++; return this.token('rightBracket', char, start); }
        if (char === '.') { this.offset++; return this.token('dot', char, start); }
        if (this.input.startsWith('->', start)) { this.offset += 2; return this.token('arrow', '->', start); }
        if (char === '(') { this.offset++; return this.token('leftParen', char, start); }
        if (char === ')') { this.offset++; return this.token('rightParen', char, start); }
        if (char === "'") { return this.characterLiteral(); }
        if (/[0-9]/.test(char)) { return this.integerLiteral(); }
        if (/[A-Za-z_]/.test(char)) {
            this.offset++;
            while (/[A-Za-z0-9_]/.test(this.input[this.offset] ?? '')) { this.offset++; }
            return this.token('identifier', this.input.slice(start, this.offset), start);
        }
        for (const operator of OPERATORS) {
            if (this.input.startsWith(operator, start)) {
                this.offset += operator.length;
                return this.token('operator', operator, start);
            }
        }
        throw new Error(`Unexpected character '${char}' at position ${start + 1}`);
    }

    private integerLiteral(): Token {
        const start = this.offset;
        if (this.input.startsWith('0x', start) || this.input.startsWith('0X', start)) {
            this.offset += 2;
            const digits = this.offset;
            while (/[0-9A-Fa-f]/.test(this.input[this.offset] ?? '')) { this.offset++; }
            if (this.offset === digits) { throw new Error(`Expected hexadecimal digits at position ${this.offset + 1}`); }
        } else {
            while (/[0-9]/.test(this.input[this.offset] ?? '')) { this.offset++; }
        }
        while (/[uUlL]/.test(this.input[this.offset] ?? '')) { this.offset++; }
        return this.token('integer', this.input.slice(start, this.offset), start);
    }

    private characterLiteral(): Token {
        const start = this.offset++;
        if (this.input[this.offset] === undefined || this.input[this.offset] === '\n') {
            throw new Error(`Unterminated character literal at position ${start + 1}`);
        }
        if (this.input[this.offset] === '\\') {
            this.offset++;
            if (this.input[this.offset] === 'x') {
                this.offset++;
                const digits = this.offset;
                while (/[0-9A-Fa-f]/.test(this.input[this.offset] ?? '') && this.offset - digits < 2) { this.offset++; }
                if (this.offset === digits) { throw new Error(`Expected hexadecimal escape at position ${this.offset + 1}`); }
            } else if (this.input[this.offset] !== undefined) {
                this.offset++;
            }
        } else {
            this.offset++;
        }
        if (this.input[this.offset] !== "'") { throw new Error(`Expected closing quote at position ${this.offset + 1}`); }
        this.offset++;
        return this.token('integer', this.input.slice(start, this.offset), start);
    }

    private token(kind: Token['kind'], text: string, offset: number): Token {
        this.tokenCount++;
        if (this.tokenCount > MAX_TOKENS) { throw new Error('Expression has too many tokens'); }
        return { kind, text, offset };
    }
}

class Parser {
    private index = 0;
    private depth = 0;

    constructor(private readonly tokens: readonly Token[]) {}

    parse(): Expression {
        const expression = this.parseBinary(1);
        const token = this.current();
        if (token.kind !== 'end') { throw new Error(`Unexpected token '${token.text}' at position ${token.offset + 1}`); }
        return expression;
    }

    private parseBinary(minimumPrecedence: number): Expression {
        let left = this.parseUnary();
        while (this.current().kind === 'operator') {
            const operator = this.current().text as BinaryOperator;
            const precedence = BINARY_PRECEDENCE[operator];
            if (precedence === undefined || precedence < minimumPrecedence) { break; }
            this.index++;
            const right = this.parseBinary(precedence + 1);
            left = { kind: 'binary', operator, left, right };
        }

        return left;
    }

    private parseUnary(): Expression {
        const token = this.current();

        if (token.kind === 'operator' && ['+', '-', '~', '!', '*', '&'].includes(token.text)) {
            this.index++;
            return { kind: 'unary', operator: token.text as UnaryOperator, operand: this.parseUnary() };
        }
        if (token.kind === 'leftParen') {
            this.index++;
            this.depth++;

            if (this.depth > MAX_PARSE_DEPTH) { throw new Error('Expression nesting is too deep'); }
            const cast = this.parseCastType();
            if (cast) {
                this.depth--;
                return { kind: 'cast', typeName: cast, operand: this.parseUnary() };
            }
            const expression = this.parseBinary(1);
            this.depth--;
            if (this.current().kind !== 'rightParen') { throw new Error(`Expected ')' at position ${this.current().offset + 1}`); }
            this.index++;
            return this.parsePostfix(expression);
        }
        if (token.kind === 'integer') { this.index++; return this.parsePostfix({ kind: 'integer', value: parseLiteral(token) }); }
        if (token.kind === 'identifier') { this.index++; return this.parsePostfix({ kind: 'identifier', name: token.text }); }
        throw new Error(`Expected an expression at position ${token.offset + 1}`);
    }

    private parsePostfix(expression: Expression): Expression {
        let result = expression;
        while (this.current().kind === 'leftBracket' || this.current().kind === 'dot' || this.current().kind === 'arrow') {
            const token = this.current();
            this.index++;
            if (token.kind === 'leftBracket') {
                const index = this.parseBinary(1);
                if (this.current().kind !== 'rightBracket') { throw new Error(`Expected ']' at position ${this.current().offset + 1}`); }
                this.index++;
                result = { kind: 'index', object: result, index };
            } else {
                const member = this.current();
                if (member.kind !== 'identifier') { throw new Error(`Expected member name at position ${member.offset + 1}`); }
                this.index++;
                result = { kind: 'member', object: result, name: member.text, throughPointer: token.kind === 'arrow' };
            }
        }
        return result;
    }

    private parseCastType(): string | undefined {
        const start = this.index;
        const parts: string[] = [];
        while (this.current().kind === 'identifier' || (this.current().kind === 'operator' && this.current().text === '*')) {
            parts.push(this.current().text);
            this.index++;
        }
        if (parts.length > 0 && this.current().kind === 'rightParen') {
            this.index++;
            const next = this.current();
            if (next.kind === 'identifier' || next.kind === 'integer' || next.kind === 'leftParen' || (next.kind === 'operator' && ['+', '-', '~', '!', '*', '&'].includes(next.text))) {
                return parts.join(' ').replace(/ \*/g, ' *');
            }
        }
        this.index = start;
        return undefined;
    }

    private current(): Token { return this.tokens[this.index]; }
}

function parseLiteral(token: Token): number {
    if (token.text.startsWith("'")) { return parseCharacterLiteral(token); }
    const digits = token.text.replace(/[uUlL]+$/, '');
    const value = digits.startsWith('0x') || digits.startsWith('0X') ? Number.parseInt(digits.slice(2), 16) : Number.parseInt(digits, 10);
    return checked(value);
}

function parseCharacterLiteral(token: Token): number {
    const content = token.text.slice(1, -1);
    if (!content.startsWith('\\')) { return content.charCodeAt(0); }
    const escaped = content.slice(1);
    const escapes: Record<string, number> = { '0': 0, 'a': 7, 'b': 8, 't': 9, 'n': 10, 'v': 11, 'f': 12, 'r': 13, "'": 39, '"': 34, '\\': 92 };
    if (escaped.startsWith('x')) { return Number.parseInt(escaped.slice(1), 16); }
    if (escapes[escaped] === undefined) { throw new Error(`Unsupported character escape at position ${token.offset + 1}`); }
    return escapes[escaped];
}

function evaluateUnary(operator: UnaryOperator, value: number): number {
    switch (operator) {
        case '+': return value;
        case '-': return checked(-value);
        case '~': return ~value;
        case '!': return value === 0 ? 1 : 0;
        case '*': case '&': throw new Error('Expression requires typed variable context');
    }
}

function evaluateBinary(operator: Exclude<BinaryOperator, '&&' | '||'>, left: number, right: number): number {
    switch (operator) {
        case '*': return checked(left * right);
        case '/': if (right === 0) { throw new Error('Division by zero'); } return checked(Math.trunc(left / right));
        case '%': if (right === 0) { throw new Error('Division by zero'); } return checked(left % right);
        case '+': return checked(left + right);
        case '-': return checked(left - right);
        case '<<': return checked(left << shiftCount(right));
        case '>>': return left >> shiftCount(right);
        case '<': return left < right ? 1 : 0;
        case '<=': return left <= right ? 1 : 0;
        case '>': return left > right ? 1 : 0;
        case '>=': return left >= right ? 1 : 0;
        case '==': return left === right ? 1 : 0;
        case '!=': return left !== right ? 1 : 0;
        case '&': return left & right;
        case '^': return left ^ right;
        case '|': return left | right;
    }
}

function shiftCount(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 31) { throw new Error('Shift count must be between 0 and 31'); }
    return value;
}

function checked(value: number): number {
    if (!Number.isSafeInteger(value)) { throw new Error('Expression is outside the safe integer range'); }
    return value;
}

interface TypedExpressionValue { scalar?: number; typed?: TypedValue; address?: number; type?: TypeInfo; }

function typedScalarValue(value: number): TypedExpressionValue { return { scalar: checked(value), typed: scalarTypedValue(value) }; }
function scalarTypedValue(value: number): TypedValue { return { bytes: new Uint8Array([value & 0xFF, value >>> 8 & 0xFF]), availability: 'available' }; }
function typedValue(value: number, type: TypeInfo): TypedValue {
    const bytes = new Uint8Array(Math.max(1, Math.min(type.byteSize || 2, 4)));
    for (let index = 0; index < bytes.length; index++) { bytes[index] = value >>> (index * 8) & 0xFF; }
    return { type, bytes, availability: 'available' };
}
function fromTypedValue(value: TypedValue, name?: string): TypedExpressionValue {
    if (value.availability !== 'available') { throw new Error(`Cannot use ${name ?? 'value'}: ${value.availability.replace('-', ' ')}`); }
    return { typed: value, scalar: isScalar(value.type) ? decode(value.bytes) : undefined, address: value.address, type: value.type };
}
function typedScalar(value: TypedExpressionValue): number {
    if (value.scalar !== undefined) { return value.scalar; }
    if (value.typed && isScalar(value.typed.type)) { return decode(value.typed.bytes); }
    throw new Error('Expression requires an unsupported type');
}
function isScalar(type: TypeInfo | undefined): boolean {
    const kind = type && unwrap(type).kind;
    return type === undefined || !kind || kind === 'base' || kind === 'enum' || kind === 'pointer' || kind === 'reference';
}
function unwrap(type: TypeInfo): TypeInfo { return type.kind === 'typedef' || type.kind === 'qualified' ? type.of ? unwrap(type.of) : type : type; }
function decode(bytes: Uint8Array | undefined): number { let value = 0; for (let index = 0; index < Math.min(bytes?.length ?? 0, 4); index++) { value |= bytes![index] << (index * 8); } return value >>> 0; }
function typedAddress(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) { throw new Error(`Pointer 0x${(value >>> 0).toString(16).padStart(4, '0').toUpperCase()} is outside readable memory`); }
    return value;
}