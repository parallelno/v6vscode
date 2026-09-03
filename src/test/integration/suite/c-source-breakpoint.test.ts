import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';
import { loadDebugArtifact } from '../../../debug/metadata/debug-artifact-loader';

suite('C source breakpoint', () => {
    test('stops the real emulator before executing the display write', async function () {
        const extensionRoot = process.env.V6_EXTENSION_ROOT;
        const emulator = process.env.V6EMUL;
        if (!extensionRoot || !emulator || !fs.existsSync(emulator)) {
            this.skip();
            return;
        }

        const sourceUri = vscode.Uri.file(path.join(extensionRoot, 'temp', 'cdbg', 'probe.c'));
        const sourceLines = fs.readFileSync(sourceUri.fsPath, 'utf8').split(/\r?\n/);
        const targetLine = sourceLines.findIndex(line => line.includes('uint8_t s =')) + 1;
        assert.ok(targetLine > 0, 'Expected the innermost C integration breakpoint statement.');
        const artifact = await loadDebugArtifact(
            path.join(extensionRoot, 'temp', 'cdbg', 'probe-O0.elf'),
            path.join(extensionRoot, 'temp', 'cdbg', 'probe-O0.rom'),
        );
        const resolvedBreakpoint = artifact.index.resolveBreakpoint(sourceUri.fsPath, targetLine);
        assert.ok(
            resolvedBreakpoint && resolvedBreakpoint.verifiedLine === targetLine,
            `Extension Host source files: ${JSON.stringify(artifact.index.sourceFiles)}`,
        );
        const breakpoint = new vscode.SourceBreakpoint(
            new vscode.Location(sourceUri, new vscode.Position(targetLine - 1, 0)),
        );
        vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
        vscode.debug.addBreakpoints([breakpoint]);

        const stopped = new Promise<any>((resolve, reject) => {
            const timer = setTimeout(() => {
                disposable.dispose();
                reject(new Error(`Timed out waiting for C breakpoint; breakpoints=${JSON.stringify(vscode.debug.breakpoints)}`));
            }, 12_000);
            const disposable = vscode.debug.onDidChangeActiveStackItem(async item => {
                if (!(item instanceof vscode.DebugStackFrame)) { return; }
                const response = await item.session.customRequest('stackTrace', {
                    threadId: item.threadId,
                    startFrame: 0,
                    levels: 10,
                });
                const frame = response?.stackFrames?.[0];
                if (path.normalize(frame?.source?.path ?? '') !== path.normalize(sourceUri.fsPath)
                    || frame?.line !== targetLine) { return; }
                clearTimeout(timer);
                disposable.dispose();
                resolve(response.stackFrames);
            });
        });

        const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
            type: 'v6',
            request: 'launch',
            name: 'C breakpoint integration',
        });
        assert.strictEqual(started, true);

        try {
            const frames = await stopped;
            assert.deepStrictEqual(frames.slice(0, 3).map((frame: any) => frame.name), ['add8', 'accumulate', 'main']);
            assert.strictEqual(frames[0].line, targetLine);
            assert.match(frames[0].instructionPointerReference, /^0x[0-9A-F]{4}$/);

            const session = vscode.debug.activeDebugSession;
            assert.ok(session, 'Expected an active debug session at the C breakpoint.');
            const scopes = await session.customRequest('scopes', { frameId: frames[0].id });
            assert.deepStrictEqual(scopes.scopes.slice(0, 4).map((scope: any) => scope.name), ['Parameters', 'Locals', 'Statics', 'Globals']);
            const parameters = await session.customRequest('variables', { variablesReference: scopes.scopes[0].variablesReference });
            const locals = await session.customRequest('variables', { variablesReference: scopes.scopes[1].variablesReference });
            assert.deepStrictEqual(parameters.variables.map((variable: any) => variable.name).sort(), ['a', 'b']);
            assert.deepStrictEqual(parameters.variables.map((variable: any) => variable.value).sort(), ['0', '1']);
            assert.ok(locals.variables.some((variable: any) => variable.name === 's'), 'Expected add8 local s.');

            const watch = await session.customRequest('evaluate', { expression: 's', frameId: frames[0].id, context: 'watch' });
            assert.strictEqual(watch.result, '0');
        } finally {
            await vscode.commands.executeCommand('workbench.action.debug.stop');
            vscode.debug.removeBreakpoints([breakpoint]);
        }
    });
});