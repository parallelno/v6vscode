import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';
import { localPathKey } from '../../../platform/files/local-path';

suite('Source path ownership in the shipped extension', () => {
    test('creates include links from the source directory with exact ranges and missing-target links', async () => {
        const workspace = process.env.V6_DEBUG_INTEGRATION_WORKSPACE!;
        const directory = path.join(workspace, 'include-links', 'src');
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, 'existing.inc'), 'nop\n');
        const uri = vscode.Uri.file(path.join(directory, 'main.asm'));
        fs.writeFileSync(uri.fsPath, '😀 .include "existing.inc"\r\n.include "missing.inc"\r\n');
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(document, 'asm');
        const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>('vscode.executeLinkProvider', uri);
        assert.ok(links); assert.strictEqual(links.length, 2);
        for (const [index, operand] of ['existing.inc', 'missing.inc'].entries()) {
            assert.strictEqual(document.getText(links[index].range), operand);
            assert.strictEqual(localPathKey(links[index].target!.fsPath), localPathKey(path.join(directory, operand)));
        }
    });

    test('keeps DAP, definition and hover navigation on a project in the second nested workspace folder', async function () {
        if (!process.env.V6EMUL || !fs.existsSync(process.env.V6EMUL)) { this.skip(); return; }
        this.timeout(20000);
        const root = process.env.V6_EXTENSION_ROOT!;
        const first = process.env.V6_DEBUG_INTEGRATION_WORKSPACE!;
        const second = process.env.V6_PATH_INTEGRATION_WORKSPACE!;
        assert.strictEqual(localPathKey(vscode.workspace.workspaceFolders![1].uri.fsPath), localPathKey(second));
        const fixture = path.join(root, 'test', 'fixtures', 'asm-values');
        const originalProject = path.join(first, 'cdbg.project.json');
        const hiddenProject = `${originalProject}.disabled`;
        const projectFile = path.join(second, 'game.project.json');
        const uri = vscode.Uri.file(path.join(second, 'main.asm'));
        fs.copyFileSync(path.join(fixture, 'main.asm'), uri.fsPath);
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(document, 'asm');
        const editor = await vscode.window.showTextDocument(document);
        const lines = document.getText().split(/\r?\n/);
        const callLine = lines.findIndex(line => line.includes('value-presentation breakpoint'));
        const labelLine = lines.findIndex(line => line.startsWith('set_timer:'));
        const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(callLine, 0)));
        let listener: vscode.Disposable | undefined; let timer: NodeJS.Timeout | undefined;
        try {
            fs.renameSync(originalProject, hiddenProject);
            fs.writeFileSync(projectFile, JSON.stringify({ name: 'nested-game', run: {
                executable: path.join(fixture, 'main.rom'), debugArtifact: path.join(fixture, 'main.elf'), loadAddr: '0x100', speed: 'max',
            } }));
            vscode.debug.removeBreakpoints(vscode.debug.breakpoints); vscode.debug.addBreakpoints([breakpoint]);
            const stopped = new Promise<vscode.DebugStackFrame>((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Nested workspace breakpoint did not stop on its project source')), 12000);
                listener = vscode.debug.onDidChangeActiveStackItem(item => {
                    if (item instanceof vscode.DebugStackFrame) { clearTimeout(timer); resolve(item); }
                });
            });
            // Intentionally launch from the first workspace: project selection, not
            // the invoking folder, must anchor metadata paths.
            assert.strictEqual(await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
                type: 'v6', request: 'launch', name: 'Nested source anchor',
            }), true);
            const frame = await stopped;
            const stack = await frame.session.customRequest('stackTrace', { threadId: frame.threadId, startFrame: 0, levels: 1 });
            assert.strictEqual(localPathKey(stack.stackFrames[0].source.path), localPathKey(uri.fsPath));
            assert.strictEqual(stack.stackFrames[0].line, callLine + 1);
            const position = new vscode.Position(callLine, lines[callLine].indexOf('set_timer') + 1);
            const definitions = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeDefinitionProvider', uri, position);
            assert.ok(definitions?.length); assert.strictEqual(localPathKey(definitions[0].uri.fsPath), localPathKey(uri.fsPath));
            assert.strictEqual(definitions[0].range.start.line, labelLine);
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position);
            const markdown = (hovers ?? []).flatMap(hover => hover.contents.map(content => typeof content === 'string' ? content : content.value)).join('\n');
            const encoded = /command:v6\.revealSymbolSource\?([^\s)]+)/.exec(markdown)?.[1];
            assert.ok(encoded, markdown);
            const source = JSON.parse(decodeURIComponent(encoded));
            await vscode.commands.executeCommand('v6.revealSymbolSource', source);
            assert.strictEqual(localPathKey(vscode.window.activeTextEditor!.document.uri.fsPath), localPathKey(uri.fsPath));
            assert.strictEqual(vscode.window.activeTextEditor?.viewColumn, editor.viewColumn);
            assert.strictEqual(vscode.window.activeTextEditor?.selection.start.line, labelLine);
        } finally {
            clearTimeout(timer); listener?.dispose();
            await vscode.commands.executeCommand('workbench.action.debug.stop');
            vscode.debug.removeBreakpoints([breakpoint]);
            fs.rmSync(projectFile, { force: true });
            if (fs.existsSync(hiddenProject)) { fs.renameSync(hiddenProject, originalProject); }
        }
    });
});