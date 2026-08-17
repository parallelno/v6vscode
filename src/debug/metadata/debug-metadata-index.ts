/**
 * Immutable query facade over the parsed DWARF metadata.
 *
 * Assembles units, types, scopes, variables, ranges, locations, and CFI into
 * a single index and exposes the feature flags downstream DAP services use to
 * gate semantic C behavior. Preserves the existing line-table behavior.
 */

import { Elf32 } from './elf32-reader';
import { DwarfSections } from './dwarf-sections';
import { DwarfStrings } from './dwarf-strings';
import { DwarfReader, CompilationUnit, Die, attribute, stringAttribute, DW_AT, DW_TAG } from './dwarf-reader';
import { DwarfTypes, TypeInfo } from './dwarf-types';
import { DwarfScopes, ScopeNode, SubprogramNode, VariableNode } from './dwarf-scopes';
import { DwarfCfi, UnwindRow } from './dwarf-cfi';
import { AddressRange } from './dwarf-ranges';
import { evaluateDwarfExpression, DwarfEvalContext, EvaluatedLocation } from './dwarf-expression';
import { locationAt } from './dwarf-locations';

export interface DebugMetadataFeatures {
    lines: boolean;
    subprograms: boolean;
    types: boolean;
    lexicalScopes: boolean;
    variableLocations: boolean;
    inlineFrames: boolean;
    callFrameInfo: boolean;
}

export class DebugMetadataIndex {
    readonly units: CompilationUnit[];
    readonly types: DwarfTypes;
    readonly scopes: DwarfScopes;
    readonly cfi: DwarfCfi;
    readonly features: DebugMetadataFeatures;
    private readonly dieByOffset = new Map<number, Die>();
    private readonly addressResolver: (unit: CompilationUnit, index: number) => number;

    constructor(elf: Elf32) {
        const sections = new DwarfSections(elf);
        const strings = new DwarfStrings(sections.strings, sections.lineStrings, sections.stringOffsets);
        const reader = new DwarfReader(sections.info, sections.abbrev, strings, sections.addressTable);
        this.addressResolver = (unit, index) => reader.resolveAddress(unit, index);
        this.units = sections.hasInfo ? reader.readUnits() : [];

        // Index all DIEs by offset for type and origin resolution.
        for (const unit of this.units) {
            if (unit.root) { this.indexDies(unit.root); }
        }

        this.types = new DwarfTypes(this.dieByOffset);
        this.scopes = new DwarfScopes(
            this.units,
            sections.locationLists,
            sections.ranges,
            (unit, index) => reader.resolveAddress(unit, index),
        );
        this.cfi = new DwarfCfi(sections.frame, 2, () => 0);
        this.features = this.detectFeatures();
    }

    // ---- Query API used by downstream layers ----

    subprogramAt(pc: number): SubprogramNode | undefined {
        return this.scopes.subprogramAt(pc);
    }

    scopeAt(pc: number): ScopeNode | undefined {
        return this.scopes.scopeAt(pc);
    }

    inlineChainAt(pc: number): ScopeNode[] {
        return this.scopes.inlineChainAt(pc);
    }

    variablesAt(pc: number): VariableNode[] {
        return this.scopes.variablesAt(pc);
    }

    typeOf(offset: number): TypeInfo | undefined {
        return this.types.resolve(offset);
    }

    typeName(die: Die): string | undefined {
        const type = attribute(die, DW_AT.type);
        const offset = typeof type?.value === 'number' ? type.value : undefined;
        return offset === undefined ? undefined : this.typeOf(offset)?.name;
    }

    cfiRowAt(pc: number): UnwindRow | undefined {
        return this.cfi.rowAt(pc);
    }

    /** Resolve an addrx index against the first compilation unit's address table. */
    resolveAddress(index: number): number {
        const unit = this.units[0];
        return unit ? this.addressResolver(unit, index) : 0;
    }

    /**
     * Evaluate a variable's active location at a PC. Prefers the parsed
     * location list; falls back to the single expression location.
     */
    evaluateVariable(variable: VariableNode, pc: number, context: DwarfEvalContext): EvaluatedLocation {
        const expression = variable.loclist
            ? locationAt(variable.loclist, pc)
            : variable.location;
        if (!expression) {
            return { kind: 'unavailable', reason: 'no location' };
        }
        return evaluateDwarfExpression(expression, context);
    }

    /** Resolve an abstract origin variable reference to its concrete DIE. */
    resolveAbstractOrigin(variable: VariableNode): VariableNode | undefined {
        if (variable.abstractOrigin === undefined) { return variable; }
        return this.scopes.variable(variable.abstractOrigin) ?? variable;
    }

    private indexDies(die: Die): void {
        this.dieByOffset.set(die.offset, die);
        for (const child of die.children) { this.indexDies(child); }
    }

    private detectFeatures(): DebugMetadataFeatures {
        const subprograms = this.scopes.subprograms.length > 0;
        const variables = this.scopes.variables.length > 0;
        return {
            lines: true, // line tables are parsed separately by the line reader
            subprograms,
            types: variables && this.scopes.variables.some(v => v.typeOffset !== undefined && this.typeOf(v.typeOffset) !== undefined),
            lexicalScopes: this.scopes.subprograms.length > 0,
            variableLocations: variables,
            inlineFrames: this.scopes.variables.some(v => v.abstractOrigin !== undefined)
                || this.scopes.subprograms.some(() => true), // inline chain detection is PC-based
            callFrameInfo: this.cfi.fdes.length > 0,
        };
    }
}
