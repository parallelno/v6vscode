import { DebugIndex } from '../metadata/debug-index';
import { DebugMetadataIndex } from '../metadata/debug-metadata-index';
import { DebugStopContext, PhysicalFrame } from '../metadata/debug-stop-context';
import { VariableNode } from '../metadata/dwarf-scopes';
import { TypeInfo } from '../metadata/dwarf-types';
import { DWARF_REG } from '../metadata/v6c-register-map';
import { CExpressionService, ExpressionValue } from './c-expression-service';
import { ValueReader } from './value-reader';
import { builtinTypeInfo, labelAddressTypeInfo, labelTypeInfo, substituteKnownSymbols, uniqueSymbolValue } from './symbol-fallback';
import { scalarValue } from './value-format';

export interface ValueEvaluationContext {
    readonly metadata?: DebugMetadataIndex;
    readonly memory?: DebugStopContext;
    readonly frame?: PhysicalFrame;
    readonly variables: readonly VariableNode[];
    readonly symbols?: Pick<DebugIndex, 'symbols'>;
    readonly registers?: Record<number, number>;
    readonly machineRegister?: (name: string) => number | undefined;
    readonly assertCurrent?: () => void;
}

export const BYTE_REGISTER_EXPRESSIONS = new Set(['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L', 'M']);

/** One typed evaluation API for Watch/Console/hover. No DAP or editor envelopes. */
export class ValueEvaluationService {
    constructor(private readonly reader = new ValueReader(), private readonly expressions = new CExpressionService()) {}

    async evaluate(expression: string, context: ValueEvaluationContext): Promise<ExpressionValue> {
        context.assertCurrent?.();
        const substituted = substituteKnownSymbols(expression, name => {
            const entry = uniqueSymbolValue(context.symbols?.symbols(name) ?? []);
            return entry?.kind === 'constant' ? entry.value : undefined;
        });
        const result = await this.expressions.evaluateValue(substituted, {
            resolve: async name => {
                context.assertCurrent?.();
                const { metadata, memory, frame } = context;
                const variable = context.variables.find(candidate => (candidate.name || metadata?.resolveAbstractOrigin(candidate)?.name) === name);
                if (variable && metadata && memory && frame) {
                    return { value: (await this.reader.evaluate(metadata, memory, frame, variable)).value, name };
                }
                const register = selectedFrameRegister(name, frame?.registers ?? context.registers ?? {}) ?? context.machineRegister?.(name);
                if (register !== undefined) {
                    const type = { ...labelAddressTypeInfo(), byteSize: BYTE_REGISTER_EXPRESSIONS.has(name.toUpperCase()) ? 1 : 2 };
                    return { value: scalarValue(register, type), name };
                }
                const entry = uniqueSymbolValue(context.symbols?.symbols(name) ?? []);
                if (!entry) { return undefined; }
                if (entry.kind !== 'memory') {
                    return { name, value: scalarValue(entry.kind === 'constant' ? entry.value : entry.address, labelAddressTypeInfo()) };
                }
                const type = labelTypeInfo(entry.byteSize);
                return { name, value: memory ? await this.reader.readAt(memory, type, entry.address)
                    : { type, address: entry.address, availability: 'unreadable' } };
            },
            read: async (type, address) => {
                context.assertCurrent?.();
                return context.memory ? this.reader.readAt(context.memory, type, address) : { type, address, availability: 'unreadable' };
            },
            resolveType: expressionTypeResolver(context.variables.map(variable => {
                const offset = variable.typeOffset ?? context.metadata?.resolveAbstractOrigin(variable)?.typeOffset;
                return offset === undefined ? undefined : context.metadata?.typeOf(offset);
            })),
        });
        context.assertCurrent?.();
        return result;
    }

}

function selectedFrameRegister(name: string, registers: Record<number, number>): number | undefined {
    const aliases: Record<string, number> = {
        A: DWARF_REG.A, B: DWARF_REG.B, C: DWARF_REG.C, D: DWARF_REG.D,
        E: DWARF_REG.E, H: DWARF_REG.H, L: DWARF_REG.L, BC: DWARF_REG.BC,
        DE: DWARF_REG.DE, HL: DWARF_REG.HL, SP: DWARF_REG.SP, PC: DWARF_REG.PC,
    };
    const register = aliases[name.toUpperCase()];
    return register === undefined ? undefined : registers[register];
}

function expressionTypeResolver(types: readonly (TypeInfo | undefined)[]): (name: string) => TypeInfo | undefined {
    const byName = new Map<string, TypeInfo>();
    const visit = (type: TypeInfo | undefined): void => {
        if (!type || byName.has(type.name)) { return; }
        byName.set(type.name, type);
        visit(type.of);
        for (const member of type.members ?? []) { visit(member.type); }
    };
    types.forEach(visit);
    return name => byName.get(name) ?? builtinTypeInfo(name);
}