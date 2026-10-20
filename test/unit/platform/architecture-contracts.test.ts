import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import * as ids from '../../../src/config/contribution-ids';

interface Edge { target: string; typeOnly: boolean }

function edges(source: ts.SourceFile): Edge[] {
    const result: Edge[] = [];
    function visit(node: ts.Node): void {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = node.importClause;
            const bindings = clause?.namedBindings;
            const typeOnly = clause?.isTypeOnly === true || (!clause?.name && bindings !== undefined
                && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly));
            result.push({ target: node.moduleSpecifier.text, typeOnly });
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const bindings = node.exportClause;
            const typeOnly = node.isTypeOnly || (bindings !== undefined && ts.isNamedExports(bindings)
                && bindings.elements.length > 0 && bindings.elements.every(item => item.isTypeOnly));
            result.push({ target: node.moduleSpecifier.text, typeOnly });
        } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
            && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) {
            result.push({ target: node.moduleReference.expression.text, typeOnly: node.isTypeOnly });
        } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])
            && ((ts.isIdentifier(node.expression) && node.expression.text === 'require') || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
            result.push({ target: node.arguments[0].text, typeOnly: false });
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    return result;
}

function sourceFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(file) : file.endsWith('.ts') ? [file] : [];
    });
}

describe('Architecture and extension manifest contracts', () => {
    const root = process.cwd();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    it('keeps dormant CPU Statistics and removed migration paths absent while active tools remain contributed', () => {
        for (const relative of ['src/emulator/panel/cpu-statistics-panel.ts', 'src/emulator/lifecycle/emulator-lifecycle.ts',
            'src/debug/adapter/value-format.ts', 'src/debug/views/scripts-query.ts', 'src/emulator/memory/memory-space.ts']) {
            assert.strictEqual(fs.existsSync(path.join(root, relative)), false, relative);
        }
        const serialized = JSON.stringify(manifest.contributes);
        assert.ok(serialized.includes('v6.hardwareStatistics'));
        assert.ok(!serialized.includes('v6emulCpuStatistics'));
        assert.ok(fs.existsSync(path.join(root, 'src/debug/hardware-statistics/hardware-statistics-format.ts')));
    });

    it('classifies type-only imports separately from executable and side-effect imports', () => {
        const source = ts.createSourceFile('sample.ts', `import type { A } from 'a'; import { type B } from 'b';
            import 'c'; export type { D } from 'd'; const e = require('e'); const f = import('f');
            export { type G } from 'g';`, ts.ScriptTarget.Latest, true);
        assert.deepStrictEqual(edges(source), [
            { target: 'a', typeOnly: true }, { target: 'b', typeOnly: true }, { target: 'c', typeOnly: false },
            { target: 'd', typeOnly: true }, { target: 'e', typeOnly: false }, { target: 'f', typeOnly: false },
            { target: 'g', typeOnly: true },
        ]);
    });

    it('prevents new core-to-panel dependencies and runtime host dependencies in pure modules', () => {
        const exceptions = new Set<string>();
        const seen = new Set<string>();
        const failures: string[] = [];
        const src = path.join(root, 'src');
        for (const file of sourceFiles(src)) {
            const relative = path.relative(src, file).replace(/\\/g, '/');
            if (relative.startsWith('test/')) { continue; }
            const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
            const core = /^(shared\/|emulator\/(?!panel\/)|debug\/(?!views\/))/.test(relative);
            const pure = /^(shared\/|debug\/metadata\/|debug\/utilities\/|debug\/values\/|debug\/session\/)/.test(relative) || /-codec\.ts$/.test(relative);
            for (const edge of edges(source)) {
                const resolved = edge.target.startsWith('.')
                    ? path.relative(src, path.resolve(path.dirname(file), edge.target)).replace(/\\/g, '/') : edge.target;
                if (core && /^(debug\/views\/|emulator\/panel\/)/.test(resolved)) {
                    const key = `${relative} -> ${resolved}`;
                    if (!edge.typeOnly || !exceptions.has(key)) { failures.push(key); }
                    else { seen.add(key); }
                }
                if (pure && edge.target === 'vscode' && !edge.typeOnly) { failures.push(`${relative}: runtime vscode import`); }
                if (relative.startsWith('debug/views/') && relative !== 'debug/views/hex-viewer-provider.ts'
                    && resolved === 'debug/views/hex-viewer-provider') { failures.push(`${relative}: concrete sibling navigation dependency`); }
                if ((relative.startsWith('debug/values/') || relative.startsWith('language/')) && resolved.startsWith('debug/adapter/')) {
                    failures.push(`${relative}: domain/language depends on DAP adapter: ${resolved}`);
                }
                if (relative.startsWith('shared/') && !edge.target.startsWith('.')) { failures.push(`${relative}: non-browser dependency ${edge.target}`); }
                if (relative.startsWith('shared/') && edge.target.startsWith('.') && !resolved.startsWith('shared/')) {
                    failures.push(`${relative}: shared dependency escapes browser-safe boundary: ${resolved}`);
                }
            }
        }
        assert.deepStrictEqual(failures, []);
        assert.deepStrictEqual([...seen].sort(), [...exceptions].sort(), 'Remove obsolete architecture exceptions');
    });

    it('pins API types and lockfile to the truthful engine floor', () => {
        const floor = manifest.engines.vscode.slice(1);
        assert.strictEqual(manifest.engines.vscode, '^1.90.0');
        assert.strictEqual(manifest.devDependencies['@types/vscode'], floor);
        const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
        assert.strictEqual(lock.packages[''].engines.vscode, manifest.engines.vscode);
        assert.strictEqual(lock.packages['node_modules/@types/vscode'].version, floor);
        assert.ok(manifest.scripts['test:integration:minimum'].includes('--minimum'));
    });

    it('keeps contributed commands, menus, settings and debugger IDs in agreement', () => {
        const commands: string[] = manifest.contributes.commands.map((item: { command: string }) => item.command);
        assert.strictEqual(commands.length, new Set(commands).size, 'Duplicate contributed commands');
        const declared = new Set<string>();
        for (const file of sourceFiles(path.join(root, 'src'))) {
            if (file.includes(`${path.sep}test${path.sep}`)) { continue; }
            const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
            function visit(node: ts.Node): void {
                if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text.startsWith('CMD_')
                    && node.initializer && ts.isStringLiteral(node.initializer)) { declared.add(node.initializer.text); }
                ts.forEachChild(node, visit);
            }
            visit(source);
        }
        for (const command of commands) { assert.ok(declared.has(command), `Undeclared manifest command ${command}`); }
        for (const [name, value] of Object.entries(ids)) {
            if (name.startsWith('CMD_')) { assert.ok(commands.includes(value), name); }
            if (name.startsWith('SETTING_')) { assert.ok(value in manifest.contributes.configuration.properties, name); }
        }
        for (const menu of Object.values(manifest.contributes.menus) as Array<Array<{ command: string }>>) {
            for (const item of menu) { assert.ok(commands.includes(item.command), `Unknown menu command ${item.command}`); }
        }
        assert.strictEqual(manifest.contributes.debuggers[0].type, ids.DEBUG_TYPE);
        const views = (Object.values(manifest.contributes.views) as Array<Array<{ id: string }>>).flat().map(view => view.id);
        assert.strictEqual(views.length, new Set(views).size, 'Duplicate contributed views');
        assert.ok(views.includes('v6.hardwareStatistics'));
        assert.ok(views.includes('v6emul.panels'));
        assert.ok(manifest.scripts.compile.includes('compile:browser-shared'));
        assert.ok(manifest.scripts.compile.includes('check:browser'));
        const browserConfig = JSON.parse(fs.readFileSync(path.join(root, 'tsconfig.browser.json'), 'utf8'));
        assert.strictEqual(browserConfig.compilerOptions.checkJs, true);
        assert.deepStrictEqual(browserConfig.compilerOptions.types, []);
        assert.ok(browserConfig.include.includes('src/debug/views/assets/**/*.js'));
        assert.ok(browserConfig.include.includes('src/emulator/panel/assets/**/*.js'));
        const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8');
        assert.ok(ignore.includes('!src/debug/views/assets/**'));
        assert.ok(!/^out\/(?:\*\*)?\s*$/m.test(ignore), 'Compiled resources must ship');
    });
});