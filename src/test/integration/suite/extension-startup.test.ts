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
        if (process.env.V6_EXPECT_MINIMUM) { assert.strictEqual(vscode.version, process.env.V6_EXPECT_MINIMUM); }
        assert.strictEqual(typeof vscode.DebugStackFrame, 'function');
        assert.strictEqual(typeof vscode.debug.onDidChangeActiveStackItem, 'function');

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

    test('loads shared numeric, script-matching and address ESM in a CSP-restricted shipped webview', async () => {
        const extension = vscode.extensions.getExtension('parallelno.v6vscode')!;
        const root = vscode.Uri.joinPath(extension.extensionUri, 'out', 'webview');
        const panel = vscode.window.createWebviewPanel('v6.numericSmoke', 'Numeric smoke', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [root] });
        const moduleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'numbers.js'));
        const matcherUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'script-name-match.js'));
        const memoryUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'memory-space.js'));
        try {
            const result = new Promise<unknown>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Shared numeric module did not load in webview')), 10000);
                panel.webview.onDidReceiveMessage(value => { clearTimeout(timer); resolve(value); });
            });
            panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy"
                content="default-src 'none'; script-src ${panel.webview.cspSource} 'nonce-numericSmoke';"></head><body>
                <script type="module" nonce="numericSmoke">
                    import { parseIntegerLiteral, formatHex } from '${moduleUri}';
                    import { matchesScriptName } from '${matcherUri}';
                    import { globalAddressMemoryLocation, memorySpaceGlobalAddress } from '${memoryUri}';
                    const location = globalAddressMemoryLocation(0x80020);
                    acquireVsCodeApi().postMessage({ byte: parseIntegerLiteral('$FF'), hex: formatHex(0x20ffff, 6),
                        matches: matchesScriptName('Test Script', 'test s*'), location,
                        address: memorySpaceGlobalAddress(location.space, location.offset) });
                </script></body></html>`;
            assert.deepStrictEqual(await result, { byte: 255, hex: '0x20FFFF', matches: true,
                location: { space: { kind: 'ramDisk', disk: 2, bank: 3 }, offset: 0x20 }, address: 0x80020 });
        } finally { panel.dispose(); }
    });

    test('executes shipped Scripts and Memory Edits entry points with their real relative ESM imports', async () => {
        const extension = vscode.extensions.getExtension('parallelno.v6vscode')!;
        const assets = vscode.Uri.joinPath(extension.extensionUri, 'src', 'debug', 'views', 'assets');
        const shared = vscode.Uri.joinPath(extension.extensionUri, 'out', 'webview');
        for (const name of ['scripts', 'performance', 'memory-edits']) {
            const panel = vscode.window.createWebviewPanel('v6.browserConsumerSmoke', 'Browser consumer smoke', vscode.ViewColumn.Beside,
                { enableScripts: true, localResourceRoots: [assets, shared] });
            try {
                const entry = panel.webview.asWebviewUri(vscode.Uri.joinPath(assets, `${name}.js`));
                const result = new Promise<unknown>((resolve, reject) => {
                    const timer = setTimeout(() => reject(new Error(`${name} entry point did not load its shared imports`)), 10000);
                    panel.webview.onDidReceiveMessage(value => { clearTimeout(timer); resolve(value); });
                });
                const ids = ['query', 'count', 'status', 'rows', 'empty', 'live', 'table', 'menu', 'list-menu'];
                panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy"
                    content="default-src 'none'; script-src ${panel.webview.cspSource} 'nonce-consumerSmoke';"></head><body>
                    ${ids.map(id => id === 'query' ? '<input id="query">' : `<div id="${id}"></div>`).join('')}
                    <script nonce="consumerSmoke">const api = acquireVsCodeApi(); window.acquireVsCodeApi = () => ({
                        postMessage: message => { if (message.type === 'ready') { api.postMessage(message); } }
                    });</script><script type="module" nonce="consumerSmoke" src="${entry}"></script></body></html>`;
                assert.deepStrictEqual(await result, { type: 'ready' });
            } finally { panel.dispose(); }
        }
    });

    test('profiles unchanged keyed snapshots against full DOM rebuilding with shipped browser code', async () => {
        const extension = vscode.extensions.getExtension('parallelno.v6vscode')!;
        const shared = vscode.Uri.joinPath(extension.extensionUri, 'out', 'webview');
        const panel = vscode.window.createWebviewPanel('v6.keyedProfile', 'Keyed profile', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [shared] });
        const moduleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(shared, 'ui', 'keyed-rows.js'));
        try {
            const result = new Promise<{ before: { created: number; ms: number }; after: { created: number; ms: number }; retained: number }>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Keyed profile did not complete')), 20000);
                panel.webview.onDidReceiveMessage(value => { clearTimeout(timer); resolve(value); });
            });
            panel.webview.html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy"
                content="default-src 'none'; script-src ${panel.webview.cspSource} 'nonce-keyedProfile';"></head><body><div id="rows"></div>
                <script type="module" nonce="keyedProfile">
                import { KeyedRows } from '${moduleUri}';
                const api = acquireVsCodeApi(), parent = document.getElementById('rows');
                const entries = Array.from({length: 2000}, (_, id) => ({ id, name: 'entry ' + id }));
                function profile(keyed) {
                    parent.replaceChildren(); let created = 0; const renderer = new KeyedRows();
                    const make = entry => { created++; const row = document.createElement('div');
                        for (let i = 0; i < 5; i++) { const cell = document.createElement('span'); cell.textContent = entry.name; row.append(cell); } return row; };
                    const start = performance.now();
                    for (let i = 0; i < 20; i++) {
                        if (keyed) renderer.render(parent, entries, entry => entry.id, make);
                        else { parent.replaceChildren(); entries.forEach(entry => parent.append(make(entry))); }
                    }
                    return { created, ms: performance.now() - start };
                }
                api.postMessage({ before: profile(false), after: profile(true), retained: parent.children.length });
                </script></body></html>`;
            const measured = await result;
            console.log(`Keyed browser profile: ${JSON.stringify(measured)}`);
            assert.strictEqual(measured.before.created, 40000); assert.strictEqual(measured.after.created, 2000);
            assert.strictEqual(measured.retained, 2000);
        } finally { panel.dispose(); }
    });
});