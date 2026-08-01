export type SymbolResolver = (name: string) => number;

const BARE_SYMBOL_PATTERN = /^[A-Za-z_.@][A-Za-z0-9_.@$]*$/;
const SYMBOL_TOKEN_PATTERN = /^[A-Za-z_.@][A-Za-z0-9_.@$]*/;

export function evaluateSymbolExpression(expression: string, resolveSymbol: SymbolResolver): number {
    const parser = new Parser(expression, resolveSymbol);
    const value = parser.parseExpression();
    parser.expectEnd();
    if (!Number.isSafeInteger(value)) { throw new Error('Expression is outside the safe integer range'); }
    return value;
}

export function validateSymbolExpression(expression: string): string | undefined {
    try {
        evaluateSymbolExpression(expression, () => 0);
        return undefined;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

export function bareSymbol(expression: string): string | undefined {
    const value = expression.trim();
    return BARE_SYMBOL_PATTERN.test(value) ? value : undefined;
}

class Parser {
    private offset = 0;

    constructor(
        private readonly input: string,
        private readonly resolveSymbol: SymbolResolver,
    ) {}

    parseExpression(): number {
        let value = this.parseProduct();
        let parsing = true;
        while (parsing) {
            if (this.consume('+')) { value = checked(value + this.parseProduct()); }
            else if (this.consume('-')) { value = checked(value - this.parseProduct()); }
            else { parsing = false; }
        }
        return value;
    }

    expectEnd(): void {
        this.skipWhitespace();
        if (this.offset !== this.input.length) {
            throw new Error(`Unexpected token at position ${this.offset + 1}`);
        }
    }

    private parseProduct(): number {
        let value = this.parseUnary();
        while (this.consume('*')) { value = checked(value * this.parseUnary()); }
        return value;
    }

    private parseUnary(): number {
        if (this.consume('+')) { return this.parseUnary(); }
        if (this.consume('-')) { return checked(-this.parseUnary()); }
        return this.parsePrimary();
    }

    private parsePrimary(): number {
        if (this.consume('(')) {
            const value = this.parseExpression();
            if (!this.consume(')')) { throw new Error(`Expected ')' at position ${this.offset + 1}`); }
            return value;
        }

        this.skipWhitespace();
        const rest = this.input.slice(this.offset);
        const number = /^(?:0x[0-9a-f]+|\$[0-9a-f]+|[0-9a-f]+h|[0-9]+)/i.exec(rest)?.[0];
        if (number) {
            this.offset += number.length;
            return parseNumericLiteral(number);
        }
        const symbol = SYMBOL_TOKEN_PATTERN.exec(rest)?.[0];
        if (symbol) {
            this.offset += symbol.length;
            return checked(this.resolveSymbol(symbol));
        }
        throw new Error(`Expected an address, symbol, or '(' at position ${this.offset + 1}`);
    }

    private consume(token: string): boolean {
        this.skipWhitespace();
        if (!this.input.startsWith(token, this.offset)) { return false; }
        this.offset += token.length;
        return true;
    }

    private skipWhitespace(): void {
        while (/\s/.test(this.input[this.offset] ?? '')) { this.offset++; }
    }
}

function parseNumericLiteral(value: string): number {
    if (value.startsWith('$')) { return parseInt(value.slice(1), 16); }
    if (/^0x/i.test(value)) { return parseInt(value.slice(2), 16); }
    if (/h$/i.test(value)) { return parseInt(value.slice(0, -1), 16); }
    return parseInt(value, 10);
}

function checked(value: number): number {
    if (!Number.isSafeInteger(value)) { throw new Error('Expression is outside the safe integer range'); }
    return value;
}