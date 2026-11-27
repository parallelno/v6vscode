import * as assert from 'assert';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { MemoryDisplayPanel } from '../../../src/debug/views/memory-display-panel';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import type { SessionCoordinator } from '../../../src/emulator/session/session-coordinator';

describe('Memory Display panel', () => {
    it('samples only after ready, ignores a late snapshot when hidden, and disables tracking on close', async () => {
        const enable = IpcCommand.DEBUG_MEMORY_DISPLAY_ENABLE;
        const snapshot = IpcCommand.DEBUG_MEMORY_DISPLAY_SNAPSHOT;
        const calls: unknown[] = [];
        const posts: unknown[] = [];
        const navigation: unknown[] = [];
        const receive = new vscode.EventEmitter<unknown>();
        const view = new vscode.EventEmitter<void>();
        const closed = new vscode.EventEmitter<void>();
        const bytes = new Uint8Array(65536);
        const frame = (bank: number) => ({ ok: true, data: { bank, bytes, reads: bytes, writes: bytes } });
        let release!: (value: ReturnType<typeof frame>) => void;
        const pending = new Promise<ReturnType<typeof frame>>(resolve => { release = resolve; });
        const lease = { connected: true, async send(command: number, data: { bank: number }) {
            calls.push([command, data]);
            if (command === snapshot) { return calls.length === 1 ? pending : frame(data.bank); }
            return { ok: true };
        } };
        const lifecycle = Object.assign(new EventEmitter(), {
            connected: true, running: false, connectionSnapshot: { debuggerAttached: true },
            captureSession: () => lease,
            serverInfo: { capabilities: { memoryDisplaySchema: 1 }, commands: [enable, snapshot] },
        });
        const panel = { visible: true, dispose: () => closed.fire(), webview: {
            html: '', cspSource: 'test:', asWebviewUri: (uri: vscode.Uri) => uri,
            onDidReceiveMessage: receive.event, postMessage: (message: unknown) => posts.push(message),
        }, onDidChangeViewState: view.event, onDidDispose: closed.event };
        const window = vscode.window as unknown as { createWebviewPanel: unknown };
        const original = window.createWebviewPanel;
        window.createWebviewPanel = () => panel;
        const display = new MemoryDisplayPanel(vscode.Uri.file('C:\\extension'), lifecycle as unknown as SessionCoordinator,
            { open: () => navigation.push('open'), revealRange: (...args) => navigation.push(args) }, () => {});
        const flush = () => new Promise<void>(resolve => setImmediate(resolve));
        try {
            display.toggle();
            assert.strictEqual(lifecycle.listenerCount('stateChange'), 0);
            assert.deepStrictEqual(calls, []);
            const token = /data-panel-token="([^"]+)"/.exec(panel.webview.html)![1];
            const send = (message: object) => receive.fire({ ...message, panelToken: token });
            send({ type: 'ready' });
            assert.deepStrictEqual(calls, [[snapshot, { bank: 0 }]]);
            panel.visible = false;
            view.fire();
            release(frame(0));
            await flush();
            assert.deepStrictEqual(calls[1], [enable, { enabled: false }]);
            assert.strictEqual(lifecycle.listenerCount('stateChange'), 0);
            assert.ok(!posts.some(message => (message as { type: string }).type === 'snapshot'));

            send({ type: 'select', bank: 32 });
            panel.visible = true;
            view.fire();
            await flush();
            assert.deepStrictEqual(calls[2], [snapshot, { bank: 32 }]);
            send({ type: 'reveal', bank: 32, offset: 65536 });
            send({ type: 'reveal', bank: 31, offset: 65535 });
            send({ type: 'reveal', bank: 32, offset: 65535 });
            assert.deepStrictEqual(navigation, [[{ kind: 'ramDisk', disk: 8, bank: 3 }, 65535, 65535], 'open']);
            display.toggle();
            lifecycle.emit('stateChange');
            await flush();
            assert.strictEqual(lifecycle.listenerCount('stateChange'), 0);
            assert.deepStrictEqual(calls.slice(3), [[enable, { enabled: false }]]);
        } finally {
            display.dispose();
            window.createWebviewPanel = original;
        }
    });
});