/**
 * Scope, subprogram, variable, and inline index built from the DIE graph.
 *
 * Answers PC->subprogram/scope/inline/variable queries used by the Call Stack
 * and Variables layers. Variables carry raw location descriptions for the
 * expression evaluator to resolve at query time.
 */

import { attribute, blockAttribute, Die, numberAttribute, stringAttribute, DW_AT, DW_TAG, CompilationUnit } from './dwarf-reader';
import { AddressRange, inRanges, rnglistOffset, parseRngList } from './dwarf-ranges';
import { LocationListEntry, loclistOffset, parseLocationList } from './dwarf-locations';

export interface ScopeNode {
    id: number;
    kind: 'compile_unit' | 'subprogram' | 'lexical_block' | 'inlined_subroutine';
    ranges: AddressRange[];
    parent: ScopeNode | undefined;
    children: ScopeNode[];
    variables: VariableNode[];
    /** For inlined subroutines. */
    callFile?: number;
    callLine?: number;
    callColumn?: number;
    abstractOrigin?: number;
}

export interface SubprogramNode {
    id: number;
    name: string;
    linkageName?: string;
    ranges: AddressRange[];
    frameBase?: Buffer;
    returnTypeOffset?: number;
    scope: ScopeNode;
    declaration?: { file: number; line: number; column: number };
}

export interface VariableNode {
    id: number;
    name: string;
    kind: 'parameter' | 'local' | 'static' | 'global';
    typeOffset?: number;
    /** Raw location expression bytes, or undefined when unavailable. */
    location?: Buffer;
    /** Parsed loclist entries when the location is a list. */
    loclist?: LocationListEntry[];
    constValue?: number;
    declaration?: { file: number; line: number; column: number };
    abstractOrigin?: number;
}

export class DwarfScopes {
    readonly subprograms: SubprogramNode[] = [];
    readonly variables: VariableNode[] = [];
    private readonly scopeById = new Map<number, ScopeNode>();
    private readonly subprogramById = new Map<number, SubprogramNode>();
    private readonly variableById = new Map<number, VariableNode>();

    constructor(
        private readonly units: CompilationUnit[],
        private readonly loclistData: Buffer,
        private readonly rnglistData: Buffer,
        private readonly resolveAddress: (unit: CompilationUnit, index: number) => number,
    ) {
        for (const unit of units) {
            if (unit.root) { this.walkScope(unit, unit.root, undefined); }
        }
    }

    subprogramAt(pc: number): SubprogramNode | undefined {
        for (const sub of this.subprograms) {
            if (inRanges(sub.ranges, pc)) { return sub; }
        }
        return undefined;
    }

    subprogram(id: number): SubprogramNode | undefined {
        return this.subprogramById.get(id);
    }

    /** Innermost scope containing the PC. */
    scopeAt(pc: number): ScopeNode | undefined {
        let best: ScopeNode | undefined;
        for (const scope of this.scopeById.values()) {
            if (!inRanges(scope.ranges, pc)) { continue; }
            if (!best || this.depth(scope) > this.depth(best)) { best = scope; }
        }
        return best;
    }

    /** Active inline chain for a PC, ordered innermost first. */
    inlineChainAt(pc: number): ScopeNode[] {
        const chain: ScopeNode[] = [];
        for (const scope of this.scopeById.values()) {
            if (scope.kind !== 'inlined_subroutine') { continue; }
            if (inRanges(scope.ranges, pc)) { chain.push(scope); }
        }
        return chain.sort((a, b) => this.depth(b) - this.depth(a));
    }

    /** Variables visible at a PC within the active scope chain. */
    variablesAt(pc: number): VariableNode[] {
        const scope = this.scopeAt(pc);
        if (!scope) { return []; }
        const result: VariableNode[] = [];
        const visibleNames = new Set<string>();
        let current: ScopeNode | undefined = scope;
        while (current) {
            for (const variable of current.variables) {
                if (variable.name && visibleNames.has(variable.name)) { continue; }
                result.push(variable);
                if (variable.name) { visibleNames.add(variable.name); }
            }
            current = current.parent;
        }
        return result;
    }

    variableByName(name: string): VariableNode | undefined {
        return this.variables.find(variable => variable.name === name);
    }

    variable(id: number): VariableNode | undefined {
        return this.variableById.get(id);
    }

    // ---- graph construction ----

    private walkScope(unit: CompilationUnit, die: Die, parent: ScopeNode | undefined): ScopeNode | undefined {
        let scope = parent;
        const tag = die.tag;

        if (tag === DW_TAG.compile_unit) {
            scope = this.createScope(die, 'compile_unit', parent, unit);
        } else if (tag === DW_TAG.subprogram) {
            const sub = this.createSubprogram(die, parent, unit);
            scope = sub.scope;
        } else if (tag === DW_TAG.lexical_block) {
            scope = this.createScope(die, 'lexical_block', parent, unit);
        } else if (tag === DW_TAG.inlined_subroutine) {
            scope = this.createScope(die, 'inlined_subroutine', parent, unit);
        } else if (tag === DW_TAG.variable || tag === DW_TAG.formal_parameter) {
            this.addVariable(die, scope, unit);
        }

        for (const child of die.children) {
            this.walkScope(unit, child, scope);
        }
        return scope;
    }

    private createScope(die: Die, kind: ScopeNode['kind'], parent: ScopeNode | undefined, unit: CompilationUnit): ScopeNode {
        const scope: ScopeNode = {
            id: die.offset,
            kind,
            ranges: this.readRanges(die, unit),
            parent,
            children: [],
            variables: [],
            callFile: numberAttribute(die, DW_AT.call_file),
            callLine: numberAttribute(die, DW_AT.call_line),
            callColumn: numberAttribute(die, DW_AT.call_column),
            abstractOrigin: this.referenceOffset(die, DW_AT.abstract_origin),
        };
        this.scopeById.set(scope.id, scope);
        parent?.children.push(scope);
        return scope;
    }

    private createSubprogram(die: Die, parent: ScopeNode | undefined, unit: CompilationUnit): SubprogramNode {
        const scope = this.createScope(die, 'subprogram', parent, unit);
        const sub: SubprogramNode = {
            id: die.offset,
            name: stringAttribute(die, DW_AT.name) ?? '',
            linkageName: stringAttribute(die, DW_AT.linkage_name),
            ranges: scope.ranges,
            frameBase: blockAttribute(die, DW_AT.frame_base),
            returnTypeOffset: this.referenceOffset(die, DW_AT.type),
            scope,
            declaration: this.declaration(die),
        };
        this.subprograms.push(sub);
        this.subprogramById.set(sub.id, sub);
        return sub;
    }

    private addVariable(die: Die, scope: ScopeNode | undefined, unit: CompilationUnit): void {
        const kind = die.tag === DW_TAG.formal_parameter
            ? 'parameter'
            : (scope?.kind === 'compile_unit' ? 'global' : 'local');
        const variable: VariableNode = {
            id: die.offset,
            name: stringAttribute(die, DW_AT.name) ?? '',
            kind,
            typeOffset: this.referenceOffset(die, DW_AT.type),
            location: blockAttribute(die, DW_AT.location),
            constValue: numberAttribute(die, DW_AT.const_value),
            declaration: this.declaration(die),
            abstractOrigin: this.referenceOffset(die, DW_AT.abstract_origin),
        };

        // A location may be an exprloc block or a loclistx/sec_offset index.
        const locationAttr = attribute(die, DW_AT.location);
        if (locationAttr && typeof locationAttr.value === 'number' && this.loclistData.length > 0) {
            try {
                const offset = locationAttr.form === 0x22 // DW_FORM_loclistx
                    ? loclistOffset(this.loclistData, unit.loclistsBase, locationAttr.value)
                    : unit.loclistsBase + locationAttr.value;
                variable.loclist = parseLocationList(this.loclistData, offset, unit, index => this.resolveAddress(unit, index));
            } catch {
                // Leave loclist undefined; the expression fallback remains available.
            }
        }

        this.variables.push(variable);
        this.variableById.set(variable.id, variable);
        scope?.variables.push(variable);
    }

    private readRanges(die: Die, unit: CompilationUnit): AddressRange[] {
        const rangesAttr = attribute(die, DW_AT.ranges);
        if (rangesAttr && typeof rangesAttr.value === 'number' && this.rnglistData.length > 0) {
            try {
                const offset = rangesAttr.form === 0x23 // DW_FORM_rnglistx
                    ? rnglistOffset(this.rnglistData, unit.rnglistsBase, rangesAttr.value)
                    : unit.rnglistsBase + rangesAttr.value;
                return parseRngList(this.rnglistData, offset, unit, index => this.resolveAddress(unit, index));
            } catch {
                return [];
            }
        }
        const low = numberAttribute(die, DW_AT.low_pc);
        const high = numberAttribute(die, DW_AT.high_pc);
        if (low === undefined || high === undefined) { return []; }
        const highAttr = attribute(die, DW_AT.high_pc);
        const end = highAttr && highAttr.form !== 0x01 ? low + high : high; // addr vs constant length
        return [{ start: low, end }];
    }

    private referenceOffset(die: Die, name: number): number | undefined {
        const attr = attribute(die, name);
        if (!attr) { return undefined; }
        return typeof attr.value === 'number' ? attr.value : Number(attr.value);
    }

    private declaration(die: Die): { file: number; line: number; column: number } | undefined {
        const file = numberAttribute(die, DW_AT.decl_file);
        const line = numberAttribute(die, DW_AT.decl_line);
        if (file === undefined || line === undefined) { return undefined; }
        return { file, line, column: numberAttribute(die, DW_AT.decl_column) ?? 0 };
    }

    private depth(scope: ScopeNode): number {
        let depth = 0;
        let current: ScopeNode | undefined = scope;
        while (current) { depth++; current = current.parent; }
        return depth;
    }
}
