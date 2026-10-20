import * as assert from 'assert';
import * as path from 'path';
import { describe, it } from 'mocha';
import { findIncludes, resolveIncludePath } from '../../src/language/includes/include-resolution';
import { localPathKey, resolveAgainstDirectory } from '../../src/platform/files/local-path';
import { resolveDebugSourcePath } from '../../src/debug/metadata/debug-source-path';
import { splitSourcePathSegments } from '../../src/debug/metadata/source-path-segments';
import { buildDebugIndex } from '../../src/debug/metadata/debug-index';
import { ArtifactRepository } from '../../src/debug/metadata/artifact-repository';
import { DebugSymbolService } from '../../src/debug/metadata/debug-symbol-service';
import { DebugSourceSymbolLinkService } from '../../src/language/symbols/symbol-link-service';
import { projectSourceRoot } from '../../src/project/model/source-context';

describe('Path policies without VS Code or a host mock', () => {
    const root = path.resolve('path-policy-project');
    const sourceDir = path.join(root, 'source');

    function probe(existing: string[] = []) {
        const calls: string[] = [];
        return { calls, exists: (file: string) => { calls.push(file); return existing.includes(file); } };
    }

    it('retains case, commented directives, repeated calls and UTF-16/CRLF include ranges', () => {
        const text = '😀 .include "a.inc" .include "b.inc"\r\n; .include "comment.inc"\r\n.INCLUDE "upper.inc"';
        const includes = findIncludes(text);
        assert.deepStrictEqual(includes.map(item => [item.path, item.line, item.startChar]),
            [['a.inc', 0, 13], ['b.inc', 0, 30], ['comment.inc', 1, 12]]);
        assert.deepStrictEqual(findIncludes(text), includes);
        for (const item of includes) { assert.strictEqual(text.split('\n')[item.line].slice(item.startChar, item.startChar + item.path.length), item.path); }
        assert.deepStrictEqual(findIncludes('.include ""\n.include \'single.inc\'\n.include "unclosed'), []);
    });

    it('preserves absolute include spelling and host-native relative/backslash semantics', () => {
        const absolute = `${path.parse(root).root}elsewhere${path.sep}..${path.sep}missing.inc`;
        assert.strictEqual(resolveIncludePath(sourceDir, absolute), absolute);
        assert.strictEqual(resolveAgainstDirectory(sourceDir, absolute), absolute);
        for (const input of ['main.inc', '../common.inc', 'sub\\main.inc', 'sub/main.inc', '']) {
            assert.strictEqual(resolveIncludePath(sourceDir, input), path.resolve(sourceDir, input));
            assert.strictEqual(resolveAgainstDirectory(sourceDir, input), path.resolve(sourceDir, input));
        }
    });

    it('keeps include source anchoring distinct from metadata project anchoring, even for missing files', () => {
        const p = probe();
        assert.strictEqual(resolveIncludePath(sourceDir, 'missing.asm'), path.join(sourceDir, 'missing.asm'));
        assert.strictEqual(resolveDebugSourcePath('missing.asm', root, p.exists), path.join(root, 'missing.asm'));
        assert.deepStrictEqual(p.calls, [path.join(root, 'missing.asm'), path.normalize('missing.asm')]);
    });

    it('prefers an existing project-relative candidate without probing a CWD-relative fallback', () => {
        const candidate = path.join(root, 'src', 'main.asm'); const p = probe([candidate, path.normalize('src/main.asm')]);
        assert.strictEqual(resolveDebugSourcePath('src/main.asm', root, p.exists), candidate);
        assert.deepStrictEqual(p.calls, [candidate]);
    });

    it('retains the CWD-sensitive relative fallback and no-root relative output', () => {
        const normalized = path.normalize('src/main.asm'); const p = probe([normalized]);
        assert.strictEqual(resolveDebugSourcePath('src/main.asm', root, p.exists), normalized);
        assert.deepStrictEqual(p.calls, [path.join(root, 'src', 'main.asm'), normalized]);
        const emptyRoot = probe();
        assert.strictEqual(resolveDebugSourcePath('src/main.asm', '', emptyRoot.exists), normalized);
        assert.deepStrictEqual(emptyRoot.calls, [normalized]);
    });

    it('preserves single-rooted candidate short-circuit, original fallback and nonexistent fallback', () => {
        const recorded = '/src/main.asm', normalized = path.normalize(recorded), candidate = path.join(root, 'src', 'main.asm');
        for (const [existing, expected, calls] of [
            [[candidate, normalized], candidate, [candidate]],
            [[normalized], normalized, [candidate, normalized]],
            [[], candidate, [candidate, normalized]],
        ] as Array<[string[], string, string[]]>) {
            const p = probe(existing);
            assert.strictEqual(resolveDebugSourcePath(recorded, root, p.exists), expected);
            assert.deepStrictEqual(p.calls, calls);
        }
    });

    it('tries foreign-path suffixes in order and accepts the existing predicate contract, not file kind', () => {
        const recorded = 'Q:/build/engine/common/main.asm';
        const deep = path.join(root, 'engine', 'common', 'main.asm');
        const shallow = path.join(root, 'common', 'main.asm');
        const p = probe([deep, shallow]);
        assert.strictEqual(resolveDebugSourcePath(recorded, root, p.exists), deep);
        assert.deepStrictEqual(p.calls, [path.join(root, 'build', 'engine', 'common', 'main.asm'), deep]);
        const directoryLike = probe([path.join(root, 'main.asm')]);
        assert.strictEqual(resolveDebugSourcePath(recorded, root, directoryLike.exists), path.join(root, 'main.asm'));
        assert.strictEqual(resolveDebugSourcePath(recorded, root, () => false), path.normalize(recorded));
        assert.notStrictEqual(resolveIncludePath(sourceDir, recorded), deep);
    });

    it('keeps UNC segments and foreign missing paths without recursive or realpath lookup', () => {
        assert.deepStrictEqual(splitSourcePathSegments('Q:\\build//engine\\main.asm'), ['build', 'engine', 'main.asm']);
        assert.deepStrictEqual(splitSourcePathSegments('\\\\server\\share\\engine/main.asm'), ['server', 'share', 'engine', 'main.asm']);
        const p = probe();
        assert.strictEqual(resolveDebugSourcePath('\\\\server\\share\\main.asm', root, p.exists), path.normalize('\\\\server\\share\\main.asm'));
        assert.deepStrictEqual(p.calls, [path.join(root, 'server', 'share', 'main.asm'), path.join(root, 'share', 'main.asm'), path.join(root, 'main.asm')]);
    });

    it('preserves platform-specific absolute/project and literal-backslash behavior', () => {
        const p = probe(); const recorded = path.join(root, 'src', 'missing.asm');
        assert.strictEqual(resolveDebugSourcePath(recorded, root, p.exists), recorded);
        if (process.platform === 'win32') { assert.deepStrictEqual(p.calls, []); }
        else {
            assert.strictEqual(resolveDebugSourcePath('\\src\\main.asm', root, () => false), path.resolve(root, 'src\\main.asm'));
        }
        const failure = new Error('probe failure');
        assert.throws(() => resolveDebugSourcePath('main.asm', root, () => { throw failure; }), error => error === failure);
    });

    it('uses a host-local lexical file key without absolute conversion, metadata case inference or symlink resolution', () => {
        assert.strictEqual(localPathKey('src/../main.asm'), localPathKey('main.asm'));
        assert.strictEqual(localPathKey('Main.asm') === localPathKey('main.asm'), process.platform === 'win32');
        assert.notStrictEqual(localPathKey('main.asm'), localPathKey(path.join(root, 'main.asm')));
        assert.notStrictEqual(localPathKey('alias.asm'), localPathKey('target.asm'));
    });

    it('chooses the explicit project-file directory without discovering or reading global workspace state', () => {
        const nested = { uri: { fsPath: path.join(root, 'nested', 'game.project.json') } };
        assert.strictEqual(projectSourceRoot(nested, root), path.join(root, 'nested'));
        const secondRoot = path.resolve('second-workspace');
        assert.strictEqual(projectSourceRoot({ uri: { fsPath: path.join(secondRoot, 'game.project.json') } }, root), secondRoot);
        assert.strictEqual(projectSourceRoot(undefined, root), root);
        assert.strictEqual(projectSourceRoot(undefined), '');
    });

    it('keeps unique metadata matching independent of the first-existing filesystem policy', () => {
        const index = buildDebugIndex([
            { address: 0x100, file: 'Q:/build/a/main.asm', line: 1, column: 1, isStmt: true },
            { address: 0x200, file: 'Q:/build/b/main.asm', line: 1, column: 1, isStmt: true },
        ], [], '');
        assert.strictEqual(index.resolveBreakpoint('Z:/workspace/main.asm', 1), undefined);
        assert.strictEqual(index.resolveBreakpoint('Z:/workspace/a/main.asm', 1)?.address, 0x100);
    });

    it('scans injected local paths while retaining metadata filenames and source-text invalidation', async () => {
        const index = buildDebugIndex([], [], '', [], ['Q:/build/defs.asm']);
        const repository = new ArtifactRepository({ read: async () => ({ elf: Buffer.from([1]) }) },
            () => ({ index, metadata: undefined, compDir: '', validationWarning: undefined }));
        const paths: string[] = []; let text = '.macro macro_name(x)\n.endmacro';
        const service = new DebugSourceSymbolLinkService(new DebugSymbolService(repository), async file => { paths.push(file); return text; },
            (file, anchor) => { assert.strictEqual(file, path.normalize('Q:/build/defs.asm')); return path.join(anchor, 'defs.asm'); });
        const context = { projectRoot: root, debugArtifact: 'virtual.elf', executable: '' };
        const resolve = () => service.resolve('macro_name', { start: 0, length: 10 }, context);
        assert.deepStrictEqual(await resolve(), { file: path.normalize('Q:/build/defs.asm'), line: 1, column: 8, isStmt: false });
        await resolve(); assert.deepStrictEqual(paths, [path.join(root, 'defs.asm')]);
        text = '\n.macro macro_name(x)\n.endmacro'; service.invalidateSourceDefinitions();
        assert.strictEqual((await resolve())?.line, 2);
        assert.strictEqual(paths.length, 2);
        const secondRoot = path.resolve('second-project');
        assert.strictEqual((await service.resolve('macro_name', { start: 0, length: 10 }, { ...context, projectRoot: secondRoot }))?.line, 2);
        assert.strictEqual(paths[2], path.join(secondRoot, 'defs.asm'));
        text = 'nop'; service.invalidateSourceDefinitions();
        assert.strictEqual(await resolve(), undefined);
        const missingReads = paths.length;
        text = '.macro macro_name(x)\n.endmacro';
        assert.strictEqual(await resolve(), undefined, 'Negative definition cache also requires source invalidation');
        assert.strictEqual(paths.length, missingReads);
        service.invalidateSourceDefinitions();
        assert.strictEqual((await resolve())?.line, 1);
    });
});