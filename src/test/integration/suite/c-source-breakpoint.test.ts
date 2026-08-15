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

        const sourceUri = vscode.Uri.file(path.join(extensionRoot, 'temp', 'project', 'src2', 'main.c'));
        const sourceLines = fs.readFileSync(sourceUri.fsPath, 'utf8').split(/\r?\n/);
        const targetLine = sourceLines.findIndex(line => line.includes('addr[0] = 0x0F;')) + 1;
        assert.ok(targetLine > 0, 'Expected the C integration breakpoint statement.');
        const artifact = await loadDebugArtifact(
            path.join(extensionRoot, 'temp', 'project', 'out', 'demo2.elf'),
            path.join(extensionRoot, 'temp', 'project', 'out', 'demo2.rom'),
        );
        assert.deepStrictEqual(
            artifact.index.resolveBreakpoint(sourceUri.fsPath, targetLine),
            { address: 0x0151, verifiedLine: targetLine },
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
                    levels: 1,
                });
                const frame = response?.stackFrames?.[0];
                if (path.normalize(frame?.source?.path ?? '') !== path.normalize(sourceUri.fsPath)
                    || frame?.line !== targetLine) { return; }
                clearTimeout(timer);
                disposable.dispose();
                resolve(frame);
            });
        });

        const started = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders?.[0], {
            type: 'v6',
            request: 'launch',
            name: 'C breakpoint integration',
        });
        assert.strictEqual(started, true);

        try {
            const frame = await stopped;
            assert.strictEqual(frame.line, targetLine);
            assert.strictEqual(frame.instructionPointerReference, '0x0151');
        } finally {
            await vscode.commands.executeCommand('workbench.action.debug.stop');
            vscode.debug.removeBreakpoints([breakpoint]);
        }
    });
});