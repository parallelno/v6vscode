import * as assert from 'assert';
import * as vscode from 'vscode';
import { PanelHost } from '../../../src/platform/webview/panel-host';
import { webviewDocument } from '../../../src/platform/webview/webview-document';
import { RefreshController } from '../../../src/platform/async/refresh-controller';
import { decodePerformanceMessage, decodeMemoryEditsMessage } from '../../../src/debug/views/pilot-message-codecs';

describe('Composed panel infrastructure', () => {
    it('rejects malformed feature messages before service dispatch', () => {
        for (const value of [null, [], {}, { type: 'delete', generation: '1', id: 1 },
            { type: 'setActivity', generation: 1, id: 1, active: 'yes' }, { type: 'edit', generation: 1, id: 1, input: null }]) {
            assert.strictEqual(decodePerformanceMessage(value), undefined);
        }
        for (const value of [{ type: 'copy', generation: 1, globalAddr: 1, field: 'secret' },
            { type: 'add', generation: 1, globalAddr: 0x210000, value: 0 }, { type: 'setEntered', generation: 1, globalAddr: 0, value: 256 }]) {
            assert.strictEqual(decodeMemoryEditsMessage(value), undefined);
        }
        assert.ok(decodePerformanceMessage({ type: 'add', generation: 1, input: { name: 'test', active: true, addrStart: 'symbol + 1', addrEnd: 4 } }));
    });

    it('owns ready-once, panel token, visibility, teardown and stale document rejection', async () => {
        const window = vscode.window as unknown as { createWebviewPanel: unknown };
        const original = window.createWebviewPanel;
        const panels: any[] = [];
        const messages: unknown[] = [];
        const visibility: boolean[] = [];
        const open: boolean[] = [];
        window.createWebviewPanel = () => {
            const receive = new vscode.EventEmitter<unknown>();
            const view = new vscode.EventEmitter<unknown>();
            const closed = new vscode.EventEmitter<void>();
            const panel = { visible: true, reveal() {}, dispose: () => closed.fire(),
                webview: { html: '', postMessage() {}, onDidReceiveMessage: receive.event },
                onDidChangeViewState: view.event, onDidDispose: closed.event, receive, view };
            panels.push(panel); return panel;
        };
        const host = new PanelHost(vscode.Uri.file('C:\\extension'), 'test', 'Test', {
            document: (_webview, _assets, token) => token,
            decode: decodeMemoryEditsMessage,
            message: async message => { messages.push(message); }, visibility: value => visibility.push(value), closed() {}, failed: error => { throw error; },
        }, value => open.push(value));
        try {
            host.open(); const first = panels[0]; const token = first.webview.html;
            first.receive.fire({ type: 'delete', generation: 1, globalAddr: 0, panelToken: token });
            first.receive.fire({ type: 'ready', panelToken: 'wrong' });
            assert.strictEqual(messages.length, 0);
            first.receive.fire({ type: 'ready', panelToken: token }); first.receive.fire({ type: 'ready', panelToken: token });
            assert.strictEqual(messages.length, 1);
            first.visible = false; first.view.fire({}); assert.deepStrictEqual(visibility, [false]);
            const current = host.capture(); host.close(); host.open();
            assert.strictEqual(current(), false);
            first.receive.fire({ type: 'ready', panelToken: token }); assert.strictEqual(messages.length, 1);
            assert.deepStrictEqual(open, [true, false, true]);
        } finally { host.dispose(); window.createWebviewPanel = original; }
    });

    it('uses one CSP document builder with escaped titles, tokens and module resources', () => {
        const html = webviewDocument({ cspSource: 'safe:', asWebviewUri: (uri: vscode.Uri) => uri } as vscode.Webview,
            vscode.Uri.file('C:\\assets'), { title: '<unsafe>', asset: 'memory-edits', token: '"token', body: '<div id="rows"></div>', module: true });
        assert.ok(html.includes("default-src 'none'")); assert.ok(html.includes('type="module"'));
        assert.ok(html.includes('&lt;unsafe&gt;')); assert.ok(html.includes('data-panel-token="&quot;token"'));
    });

    it('coalesces latest refreshes, never overlaps work, and drops post-dispose publication', async () => {
        let finish!: () => void; let active = 0; let max = 0; let calls = 0; let publications = 0;
        const controller = new RefreshController({ enabled: () => true, capture: () => () => true, intervalMs: 1, maxBackoffMs: 4,
            refresh: async current => {
                calls++; max = Math.max(max, ++active);
                await new Promise<void>(resolve => { finish = resolve; }); active--;
                if (current()) { publications++; }
            }, failed: error => { throw error; } });
        const first = controller.request(); const second = controller.request(true); controller.request();
        assert.strictEqual(first, second); finish(); await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(calls, 2); controller.dispose(); finish(); await first;
        assert.strictEqual(max, 1); assert.strictEqual(publications, 1);
        await controller.request(); assert.strictEqual(calls, 2);
    });
});