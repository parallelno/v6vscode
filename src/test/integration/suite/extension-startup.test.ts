import * as assert from 'assert';
import * as path from 'path';
import { suite, test } from 'mocha';
import * as vscode from 'vscode';

suite('Language presentation startup', () => {
    test('activates with the installed grammar and Oniguruma WASM', async () => {
        const extension = vscode.extensions.getExtension('parallelno.v6vscode');
        assert.ok(extension, 'The v6vscode extension should be installed.');

        await extension.activate();
        assert.strictEqual(extension.isActive, true);

        await vscode.workspace.fs.stat(vscode.Uri.joinPath(
            extension.extensionUri,
            'res',
            'syntaxes',
            'v6vscode_8080.tmLanguage.json',
        ));
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(
            extension.extensionUri,
            'node_modules',
            'vscode-oniguruma',
            'release',
            'onig.wasm',
        ));

        if (process.env.V6_EXPECT_PACKAGED === 'true') {
            const sourceRoot = path.resolve(process.env.V6_EXTENSION_ROOT!).toLowerCase();
            assert.notStrictEqual(path.resolve(extension.extensionPath).toLowerCase(), sourceRoot);
        }
    });

    test('loads the shared numeric ESM in a CSP-restricted webview from shipped resources', async () => {
        const extension = vscode.extensions.getExtension('parallelno.v6vscode')!;
        const root = vscode.Uri.joinPath(extension.extensionUri, 'out', 'webview');
        const panel = vscode.window.createWebviewPanel('v6.numericSmoke', 'Numeric smoke', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [root] });
        const moduleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'numbers.js'));
        try {
            const result = new Promise<unknown>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Shared numeric module did not load in webview')), 10000);
                panel.webview.onDidReceiveMessage(value => { clearTimeout(timer); resolve(value); });
            });
            panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy"
                content="default-src 'none'; script-src ${panel.webview.cspSource} 'nonce-numericSmoke';"></head><body>
                <script type="module" nonce="numericSmoke">
                    import { parseIntegerLiteral, formatHex } from '${moduleUri}';
                    acquireVsCodeApi().postMessage({ byte: parseIntegerLiteral('$FF'), hex: formatHex(0x20ffff, 6) });
                </script></body></html>`;
            assert.deepStrictEqual(await result, { byte: 255, hex: '0x20FFFF' });
        } finally { panel.dispose(); }
    });
});