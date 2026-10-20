import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';
import { loadDebugArtifact } from '../../../debug/metadata/debug-artifact-loader';
import { ASSEMBLER_HOVER_CONTEXT } from '../../../debug/values/evaluation-context';

suite('ASM value presentation', () => {
    test('shares typed values between editor hover, Watch, Globals, and struct pools in the real emulator', async function () {
        const root = process.env.V6_EXTENSION_ROOT;
        if (!root || !process.env.V6EMUL || !fs.existsSync(process.env.V6EMUL)) {
            this.skip();
            return;
        }
        const fixture = path.join(root, 'test', 'fixtures', 'asm-values');
        const projectPath = path.join(root, 'temp', 'integration-debug-workspace', 'cdbg.project.json');
        const originalProject = fs.readFileSync(projectPath, 'utf8');
        const project = JSON.parse(originalProject);
        project.run.executable = path.join(fixture, 'main.rom');
        project.run.debugArtifact = path.join(fixture, 'main.elf');
        const uri = vscode.Uri.file(path.join(path.dirname(projectPath), 'main.asm'));
        const document = await vscode.workspace.openTextDocument(uri);
        await vscode.languages.setTextDocumentLanguage(document, 'asm');
        await vscode.window.showTextDocument(document);
        const lines = document.getText().split(/\r?\n/);
        const callLine = lines.findIndex(line => line.includes('value-presentation breakpoint'));
        const fieldLine = lines.findIndex(line => line.includes('sta instance.ptr') && !line.includes('+'));
        const artifact = await loadDebugArtifact(project.run.debugArtifact, project.run.executable);
        const functionAddress = `0x${artifact.index.symbol('set_timer')!.address.toString(16).toUpperCase().padStart(4, '0')}`;
        const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(uri, new vscode.Position(callLine, 0)));
        let subscription: vscode.Disposable | undefined;
        let timer: NodeJS.Timeout | undefined;
        try {
            fs.writeFileSync(projectPath, `${JSON.stringify(project, undefined, 2)}\n`);
            await vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
            await vscode.debug.addBreakpoints([breakpoint]);
            const stopped = new Promise<{ session: vscode.DebugSession; frame: any }>((resolve, reject) => {
                timer = setTimeout(() => reject(new Error('Timed out at the ASM value breakpoint')), 12_000);
                subscription = vscode.debug.onDidChangeActiveStackItem(async item => {
                    if (!(item instanceof vscode.DebugStackFrame)) { return; }
                    try {
                        const response = await item.session.customRequest('stackTrace', { threadId: item.threadId, startFrame: 0, levels: 10 });
                        const frame = response.stackFrames[0];
                        if (frame?.line !== callLine + 1 || path.normalize(frame?.source?.path ?? '') !== path.normalize(uri.fsPath)) { return; }
                        clearTimeout(timer);
                        subscription?.dispose();
                        resolve({ session: item.session, frame });
                    } catch (error) { reject(error); }
                });
            });
            assert.strictEqual(await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
                type: 'v6', request: 'launch', name: 'ASM value presentation integration',
            }), true);
            const { session, frame } = await stopped;
            for (const frameId of [undefined, frame.id]) {
                for (const context of ['watch', 'repl', ASSEMBLER_HOVER_CONTEXT]) {
                    const word = await session.customRequest('evaluate', { expression: 'instance.ptr', context, frameId });
                    assert.strictEqual(word.result, '65535');
                    assert.strictEqual(word.type, 'word');
                    const byteOnly = await session.customRequest('evaluate', { expression: 'byte_only.ptr', context, frameId });
                    assert.strictEqual(byteOnly.result, '255', 'Writing one byte must not fabricate a second 0xff byte.');
                    const code = await session.customRequest('evaluate', { expression: 'set_timer', context, frameId });
                    assert.strictEqual(code.result, functionAddress);
                }
            }
            // Allocate aggregate Watch handles before scope handles: this used to
            // make Parameters resolve to the first pool's children.
            const watch = await session.customRequest('evaluate', { expression: 'pool', context: 'watch', frameId: frame.id });
            const scopes = (await session.customRequest('scopes', { frameId: frame.id })).scopes;
            const parametersRef = scopes.find((scope: any) => scope.name === 'Parameters').variablesReference;
            const globalsRef = scopes.find((scope: any) => scope.name === 'Globals').variablesReference;
            assert.notStrictEqual(parametersRef, watch.variablesReference);
            const globals = (await session.customRequest('variables', { variablesReference: globalsRef })).variables;
            assert.ok(globals.some((variable: any) => variable.name === 'instance' && variable.value.includes('ptr = 65535')));
            assert.ok(globals.some((variable: any) => variable.name === 'pool'));
            const elements = (await session.customRequest('variables', { variablesReference: watch.variablesReference })).variables;
            assert.ok(elements[0].value.includes('ptr = 65535'));
            const fields = (await session.customRequest('variables', { variablesReference: elements[0].variablesReference })).variables;
            assert.strictEqual(fields.find((variable: any) => variable.name === 'ptr').value, '65535');
            assert.deepStrictEqual((await session.customRequest('variables', { variablesReference: parametersRef })).variables, []);

            const hoverText = async (line: number, symbol: string): Promise<string> => {
                const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                    'vscode.executeHoverProvider', uri, new vscode.Position(line, lines[line].indexOf(symbol) + 1),
                );
                return (hovers ?? []).flatMap(hover => hover.contents.map(content =>
                    typeof content === 'string' ? content : content.value)).join('\n').replace(/&nbsp;/g, ' ');
            };
            for (let attempt = 0; attempt < 3; attempt++) {
                const codeHover = await hoverText(callLine, 'set_timer');
                assert.ok(codeHover.includes(`Value: ${functionAddress}`), codeHover);
                assert.ok(codeHover.includes('Go to Definition'), codeHover);
                const fieldHover = await hoverText(fieldLine, 'instance.ptr');
                assert.ok(fieldHover.includes('Value: 65535'), fieldHover);
                assert.ok(fieldHover.includes('Go to Definition'), fieldHover);
            }
            await assert.rejects(async () => session.customRequest('evaluate', { expression: 'instance.ptr', context: 'hover', frameId: frame.id }),
                /Assembler hovers are provided by the language provider/);
        } finally {
            clearTimeout(timer);
            subscription?.dispose();
            await vscode.commands.executeCommand('workbench.action.debug.stop');
            await vscode.debug.removeBreakpoints([breakpoint]);
            fs.writeFileSync(projectPath, originalProject);
        }
    });
});
