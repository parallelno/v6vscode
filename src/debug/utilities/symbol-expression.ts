import { Expression, checked, evaluateUnary, evaluateBinary, parseExpression } from '../expressions/expression-syntax';
export type SymbolResolver = (name: string) => number;
const BARE_SYMBOL_PATTERN = /^[A-Za-z_.@][A-Za-z0-9_.@$]*$/;

export function evaluateSymbolExpression(input: string, resolve: SymbolResolver): number {
    const evaluate = (node: Expression): number => {
        switch (node.kind) {
            case 'integer': return node.value;
            case 'identifier': return checked(resolve(node.name));
            case 'unary': return evaluateUnary(node.operator, evaluate(node.operand));
            case 'binary': {
                if (!['+', '-', '*'].includes(node.operator)) { throw new Error('Unsupported address operator'); }
                return evaluateBinary(node.operator as '+' | '-' | '*', evaluate(node.left), evaluate(node.right));
            }
            default: throw new Error('Address expression requires a scalar symbol');
        }
    };
    return checked(evaluate(parseExpression(input, 'address')));
}
export function validateSymbolExpression(input: string): string | undefined {
    try { evaluateSymbolExpression(input, () => 0); return undefined; }
    catch (error) { return error instanceof Error ? error.message : String(error); }
}
export function bareSymbol(expression: string): string | undefined {
    const value = expression.trim();
    return BARE_SYMBOL_PATTERN.test(value) ? value : undefined;
}
