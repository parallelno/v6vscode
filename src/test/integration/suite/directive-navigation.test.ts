import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

async function waitFor<T>(read: () => T | undefined, timeoutMs = 5000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = read();
        if (value !== undefined) { return value; }
        if (Date.now() > deadline) { throw new Error('Timed out waiting for directive results'); }
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

suite('Directive navigation', () => {
    test('links, hover, definition, and diagnostics follow the workspace lookup order', async () => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        assert.ok(workspaceRoot, 'workspace folder is required');
        const directory = path.join(workspaceRoot!, 'directive-navigation');
        const presentPath = path.join(directory, 'present.inc');
        const mainPath = path.join(directory, 'main.asm');
        const absentPath = path.join(directory, 'gone.inc');

        await vscode.workspace.fs.createDirectory(vscode.Uri.file(directory));
        await vscode.workspace.fs.writeFile(vscode.Uri.file(presentPath), Buffer.from('nop\n'));
        await vscode.workspace.fs.writeFile(vscode.Uri.file(mainPath), Buffer.from([
            '.include "present.inc"',
            '.include "gone.inc"',
            'blob: .incbin "present.inc", 0, 1',
            '',
        ].join('\n')));
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(mainPath));
        await vscode.window.showTextDocument(document);

        const links = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
            'vscode.executeLinkProvider', document.uri);
        assert.strictEqual(links?.length, 2, 'one link per resolved operand');
        assert.strictEqual(links![0].target?.fsPath, presentPath);
        assert.strictEqual(links![1].target?.fsPath, presentPath);
        assert.deepStrictEqual(
            [links![0].range.start.character, links![0].range.end.character], [10, 21]);

        const hover = await vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider', document.uri, new vscode.Position(0, 14));
        assert.ok((hover ?? []).some(item => item.contents.some(part =>
            typeof part === 'object' && 'value' in part && part.value.includes('present.inc'))),
            'hover shows the resolved path');

        const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeDefinitionProvider', document.uri, new vscode.Position(0, 14));
        assert.ok((definitions ?? []).some(location => location.uri.fsPath === presentPath),
            'definition opens the included file');

        const diagnostics = await waitFor(() => {
            const found = vscode.languages.getDiagnostics(document.uri);
            return found.length > 0 ? found : undefined;
        });
        assert.strictEqual(diagnostics.length, 1, 'only the unresolved operand is reported');
        assert.strictEqual(diagnostics[0].message, 'Cannot find file "gone.inc"');
        assert.strictEqual(diagnostics[0].severity, vscode.DiagnosticSeverity.Error);
        assert.deepStrictEqual(
            [diagnostics[0].range.start.line, diagnostics[0].range.start.character], [1, 10]);

        await vscode.workspace.fs.writeFile(vscode.Uri.file(absentPath), Buffer.from('nop\n'));
        const cleared = await waitFor(() => {
            const found = vscode.languages.getDiagnostics(document.uri);
            return found.length === 0 ? found : undefined;
        });
        assert.deepStrictEqual(cleared, []);
        await vscode.workspace.fs.delete(vscode.Uri.file(absentPath));
    });
});
