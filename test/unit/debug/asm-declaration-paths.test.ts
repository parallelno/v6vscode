import * as assert from 'assert';
import * as path from 'path';
import { AsmFunctionIndex } from '../../../src/debug/metadata/asm-function-index';
import { resolveAsmDeclarationFile } from '../../../src/debug/metadata/debug-artifact-loader';
import { DW_AT, DW_FORM } from '../../../src/debug/metadata/dwarf-reader';

const attr = (name: number, value: number | string) => ({ name, value, form: DW_FORM.data4 });

function entry(tag: any, attributes: any[]) {
    return { offset: 1, tag, hasChildren: false, children: [], attributes };
}

/** Two units: a C unit first, then the v6asm unit that owns the region. */
function units(regionAttributes: any, unitAttributes: any[]) {
    const region = {
        offset: 10, tag: 0x4080, hasChildren: true,
        attributes: [attr(DW_AT.low_pc, 0x200), attr(DW_AT.high_pc, 0x20)],
        children: [entry(regionAttributes.tag, regionAttributes.attributes)],
    };
    return [
        { offset: 0, root: { offset: 0, tag: 0x11, hasChildren: true, attributes: [], children: [] } },
        { offset: 20, root: { offset: 20, tag: 0x11, hasChildren: true, attributes: unitAttributes, children: [region] } },
    ] as any;
}

const ASM_UNIT = [attr(DW_AT.comp_dir, 'C:/work/project/engine'), attr(DW_AT.stmt_list, 2222)];

describe('assembly function declaration paths', () => {
    it('records the owning unit and DW_AT_decl_file of each entry', () => {
        const index = new AsmFunctionIndex(units(
            { tag: 0x03, attributes: [attr(DW_AT.name, 'controls_check'), attr(DW_AT.low_pc, 0x200),
                attr(0x3f01, 'controls/v6_controls.asm'), attr(DW_AT.decl_file, 2), attr(DW_AT.decl_line, 5)] },
            ASM_UNIT,
        ));
        const found = index.regions[0].entries[0];
        assert.strictEqual(found.name, 'controls_check');
        assert.strictEqual(found.declFile, 2);
        assert.strictEqual(found.unitIndex, 1);
        assert.strictEqual(found.file, 'controls/v6_controls.asm');
    });

    it('omits declFile when the producer emits only the vendor path', () => {
        const index = new AsmFunctionIndex(units(
            { tag: 0x03, attributes: [attr(DW_AT.name, 'legacy'), attr(DW_AT.low_pc, 0x200),
                attr(0x3f01, 'legacy.asm'), attr(DW_AT.decl_line, 3)] },
            ASM_UNIT,
        ));
        const found = index.regions[0].entries[0];
        assert.strictEqual(found.declFile, undefined);
        assert.strictEqual(found.unitIndex, 1);
    });

    it('prefers the CU-relative declaration index over the vendor path', () => {
        const tables = [{ offset: 2222, files: ['C:/work/project/engine/other.asm', 'C:/work/project/engine/controls/v6_controls.asm'] }];
        const resolved = resolveAsmDeclarationFile({ file: 'controls/v6_controls.asm', declFile: 2, unitIndex: 1 },
            units({ tag: 0x03, attributes: [] }, ASM_UNIT), tables);
        assert.strictEqual(resolved, 'C:/work/project/engine/controls/v6_controls.asm');
    });

    it('anchors the vendor path on the owning unit, not on another compilation unit', () => {
        const parsed = units({ tag: 0x03, attributes: [] }, ASM_UNIT);
        const resolved = resolveAsmDeclarationFile({ file: 'controls/v6_controls.asm', unitIndex: 1 }, parsed, []);
        assert.strictEqual(resolved, path.normalize(path.join('C:/work/project/engine', 'controls/v6_controls.asm')));
    });

    it('keeps absolute vendor paths and leaves unanchored relative paths alone', () => {
        const absolute = resolveAsmDeclarationFile({ file: 'C:/elsewhere/main.asm', unitIndex: 1 },
            units({ tag: 0x03, attributes: [] }, ASM_UNIT), []);
        assert.strictEqual(absolute, path.normalize('C:/elsewhere/main.asm'));

        const noCompDir = units({ tag: 0x03, attributes: [] }, [attr(DW_AT.stmt_list, 0)]);
        assert.strictEqual(resolveAsmDeclarationFile({ file: 'functions.asm', unitIndex: 1 }, noCompDir, []), 'functions.asm');
    });

    it('falls back to the vendor path when the index or file table is unusable', () => {
        const parsed = units({ tag: 0x03, attributes: [] }, ASM_UNIT);
        const anchored = path.normalize(path.join('C:/work/project/engine', 'controls/v6_controls.asm'));
        // no line program at the owning unit's stmt_list
        assert.strictEqual(resolveAsmDeclarationFile({ file: 'controls/v6_controls.asm', declFile: 2, unitIndex: 1 },
            parsed, [{ offset: 999, files: ['C:/elsewhere/x.asm'] }]), anchored);
        // index past the end of the owning file table
        assert.strictEqual(resolveAsmDeclarationFile({ file: 'controls/v6_controls.asm', declFile: 9, unitIndex: 1 },
            parsed, [{ offset: 2222, files: ['C:/work/project/engine/controls/v6_controls.asm'] }]), anchored);
    });

    it('reports no location for an entry without any source information', () => {
        const resolved = resolveAsmDeclarationFile({ file: '', unitIndex: 1 },
            units({ tag: 0x03, attributes: [] }, ASM_UNIT), []);
        assert.strictEqual(resolved, undefined);
    });

    it('accepts an entry whose owning unit is outside the parsed list', () => {
        const resolved = resolveAsmDeclarationFile({ file: 'controls/v6_controls.asm', unitIndex: 7 }, [], []);
        assert.strictEqual(resolved, 'controls/v6_controls.asm');
    });
});
