import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import { parseElf32 } from '../../../src/debug/metadata/elf32-reader';
import { DebugMetadataIndex } from '../../../src/debug/metadata/debug-metadata-index';
import { DwarfScopes } from '../../../src/debug/metadata/dwarf-scopes';
import { DwarfError } from '../../../src/debug/metadata/dwarf-sections';

const FIXTURE_O0 = path.join(process.cwd(), 'temp', 'cdbg', 'probe-O0.elf');
const FIXTURE_O2 = path.join(process.cwd(), 'temp', 'cdbg', 'probe-O2.elf');
const FIXTURES_EXIST = fs.existsSync(FIXTURE_O0) && fs.existsSync(FIXTURE_O2);

function loadIndex(file: string): DebugMetadataIndex {
    return new DebugMetadataIndex(parseElf32(fs.readFileSync(file)));
}

describe('DwarfScopes lexical visibility', () => {
    it('retains only the innermost declaration of a shadowed name', () => {
        const scopes = new DwarfScopes([], Buffer.alloc(0), Buffer.alloc(0), () => 0);
        const outer: any = { id: 1, kind: 'subprogram', ranges: [{ start: 0x1000, end: 0x1100 }], parent: undefined, children: [], variables: [{ id: 1, name: 'value', kind: 'local' }, { id: 2, name: 'outer', kind: 'local' }] };
        const inner: any = { id: 2, kind: 'lexical_block', ranges: [{ start: 0x1020, end: 0x1040 }], parent: outer, children: [], variables: [{ id: 3, name: 'value', kind: 'local' }, { id: 4, name: 'inner', kind: 'local' }] };
        outer.children.push(inner);
        (scopes as any).scopeById.set(outer.id, outer);
        (scopes as any).scopeById.set(inner.id, inner);

        const visible = scopes.variablesAt(0x1020);

        expect(visible.map(variable => variable.id)).to.deep.equal([3, 4, 2]);
    });
});

(FIXTURES_EXIST ? describe : describe.skip)('DebugMetadataIndex against real V6C ELFs', () => {
    let o0: DebugMetadataIndex;
    let o2: DebugMetadataIndex;

    before(() => {
        o0 = loadIndex(FIXTURE_O0);
        o2 = loadIndex(FIXTURE_O2);
    });

    it('reads compilation units and detects subprograms', () => {
        expect(o0.units.length).to.be.greaterThan(0);
        expect(o0.units[0].version).to.equal(5);
        expect(o0.units[0].addressSize).to.equal(2);
        expect(o0.features.subprograms).to.equal(true);
        expect(o0.scopes.subprograms.map(s => s.name)).to.include.members(['main', 'accumulate', 'add8']);
    });

    it('detects types for variables', () => {
        expect(o0.features.types).to.equal(true);
        const valuesVar = o0.scopes.variables.find(v => v.name === 'values');
        expect(valuesVar).to.exist;
        expect(valuesVar!.typeOffset).to.be.a('number');
        const type = o0.typeOf(valuesVar!.typeOffset!);
        expect(type).to.exist;
        expect(type!.kind).to.equal('array');
        expect(type!.count).to.equal(4);
    });

    it('builds lexical scopes containing the active PC', () => {
        const main = o0.scopes.subprograms.find(s => s.name === 'main')!;
        const pc = main.ranges[0].start;
        const scope = o0.scopes.scopeAt(pc);
        expect(scope).to.exist;
        expect(scope!.kind).to.equal('subprogram');
    });

    it('parses CFI and provides a row for a real function', () => {
        expect(o0.features.callFrameInfo).to.equal(true);
        const main = o0.scopes.subprograms.find(s => s.name === 'main')!;
        const row = o0.cfi.rowAt(main.ranges[0].start);
        expect(row).to.exist;
        expect(row!.cfa.register).to.equal(10); // SP
        expect(row!.cfa.offset).to.equal(2);
        const returnRule = row!.registers.get(11); // PC
        expect(returnRule).to.exist;
    });

    it('exposes variables with types and locations at -O0', () => {
        expect(o0.features.variableLocations).to.equal(true);
        const resultVar = o0.scopes.variables.find(v => v.name === 'result');
        expect(resultVar).to.exist;
        expect(resultVar!.location || resultVar!.loclist).to.exist;
    });

    it('parses inline subroutines at -O2', () => {
        // Inline chains exist within main's optimized body; query inside them.
        const scopeById = (o2.scopes as unknown as { scopeById: Map<number, { kind: string; ranges: Array<{ start: number }>; callLine?: number }> }).scopeById;
        const inlineScopes = Array.from(scopeById.values()).filter(scope => scope.kind === 'inlined_subroutine');
        expect(inlineScopes.length).to.be.greaterThan(0);
        expect(inlineScopes.some(scope => scope.callLine !== undefined)).to.equal(true);
        const pc = inlineScopes[0].ranges[0].start;
        const chain = o2.scopes.inlineChainAt(pc);
        expect(chain.length).to.be.greaterThan(0);
    });

    it('parses location lists at -O2', () => {
        const resultVar = o2.scopes.variables.find(v => v.name === 'result');
        expect(resultVar).to.exist;
        expect(resultVar!.loclist).to.exist;
        expect(resultVar!.loclist!.length).to.be.greaterThan(0);
    });

    it('resolves abstract origins for inlined variables', () => {
        const inlinedParam = o2.scopes.variables.find(v => v.abstractOrigin !== undefined && v.name === '');
        void inlinedParam;
        const withOrigin = o2.scopes.variables.filter(v => v.abstractOrigin !== undefined);
        expect(withOrigin.length).to.be.greaterThan(0);
    });

    it('rejects a truncated debug_info section', () => {
        const elf = parseElf32(fs.readFileSync(FIXTURE_O0));
        const info = elf.sections.find(s => s.name === '.debug_info');
        if (!info) { return; }
        const truncated = { ...elf, sections: elf.sections.map(s => s.name === '.debug_info' ? { ...s, data: s.data.subarray(0, 8) } : s) };
        expect(() => new DebugMetadataIndex(truncated)).to.throw(DwarfError);
    });
});
