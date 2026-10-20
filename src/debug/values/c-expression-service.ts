import { Expression, checked, evaluateUnary, evaluateBinary, parseExpression } from '../expressions/expression-syntax';
import { TypeInfo } from '../metadata/dwarf-types';
import { TypedValue, scalarNumber, scalarValue, unwrap } from './value-format';

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

/** Parses and evaluates bounded, read-only scalar C expressions. */
export class CExpressionService {
    async evaluate(input: string, resolve: CExpressionResolver): Promise<number> {
        return this.evaluateNode(parseExpression(input, 'c'), resolve);
    }

    async evaluateValue(input: string, context: CExpressionContext): Promise<ExpressionValue> {
        const value = await this.evaluateTyped(parseExpression(input, 'c'), context);
        return { value: value.typed ?? scalarValue(typedScalar(value)) };
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
                    return { scalar: operand.address, type, typed: scalarValue(operand.address, type) };
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
                return fromTypedValue(scalarValue(operand, type));
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

interface TypedExpressionValue { scalar?: number; typed?: TypedValue; address?: number; type?: TypeInfo; }

function typedScalarValue(value: number): TypedExpressionValue {
    checked(value);
    if (value < -0x80000000 || value > 0xFFFFFFFF) { throw new Error('Scalar result is outside the supported 32-bit range'); }
    // Untyped results must not lose a sign or their high word before rendering.
    const type: TypeInfo | undefined = value < 0 || value > 0xFFFF
        ? { id: -300, kind: 'base', name: value < 0 ? 'int' : 'unsigned long', byteSize: 4, signed: value < 0 }
        : undefined;
    return { scalar: value, typed: scalarValue(value, type) };
}
function fromTypedValue(value: TypedValue, name?: string): TypedExpressionValue {
    if (value.availability !== 'available') { throw new Error(`Cannot use ${name ?? 'value'}: ${value.availability.replace('-', ' ')}`); }
    return { typed: value, scalar: isScalar(value.type) ? scalarNumber(value) : undefined, address: value.address, type: value.type };
}
function typedScalar(value: TypedExpressionValue): number {
    if (value.scalar !== undefined) { return value.scalar; }
    if (value.typed && isScalar(value.typed.type)) { return scalarNumber(value.typed); }
    throw new Error('Expression requires an unsupported type');
}
function isScalar(type: TypeInfo | undefined): boolean {
    const kind = type && unwrap(type).kind;
    return type === undefined || !kind || kind === 'base' || kind === 'enum' || kind === 'pointer' || kind === 'reference';
}
function typedAddress(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) { throw new Error(`Pointer 0x${(value >>> 0).toString(16).padStart(4, '0').toUpperCase()} is outside readable memory`); }
    return value;
}