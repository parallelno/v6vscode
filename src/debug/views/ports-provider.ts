import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { Logger } from '../../platform/logging/logger';
import { PortsService } from '../ports/ports-service';
import { PortsHostMessage, PortsWebviewMessage } from './ports-messages';

export const CMD_REFRESH_PORTS = 'v6.refreshPorts';

export class PortsProvider implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private readonly changeListener: () => void;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: EmulatorLifecycle,
        private readonly service: PortsService,
        private readonly logger: Logger,
        private readonly onOpenStateChanged: (open: boolean) => void = () => {},
    ) {
        this.changeListener = () => this.postCurrentState();
        this.service.on('change', this.changeListener);
    }

    toggle(): void {
        if (this.panel) this.panel.dispose();
        else this.open();
    }

    isOpen(): boolean { return this.panel !== undefined; }

    close(): void { this.panel?.dispose(); }

    open(): void {
        if (this.panel) {
            this.panel.reveal();
            return;
        }
        const assetsUri = vscode.Uri.joinPath(this.extensionUri, 'src', 'debug', 'views', 'assets');
        const panel = vscode.window.createWebviewPanel(
            'v6.ports', 'Ports', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [assetsUri], retainContextWhenHidden: true },
        );
        this.panel = panel;
        panel.webview.html = this.html(panel.webview, assetsUri);
        panel.webview.onDidReceiveMessage((message: PortsWebviewMessage) => void this.handleMessage(message));
        panel.onDidChangeViewState(event => {
            this.service.setVisible(event.webviewPanel.visible);
            if (event.webviewPanel.visible) this.postCurrentState();
        });
        panel.onDidDispose(() => {
            this.service.setVisible(false);
            this.panel = undefined;
            this.onOpenStateChanged(false);
        });
        this.service.setVisible(panel.visible);
        this.onOpenStateChanged(true);
    }

    async refresh(): Promise<void> {
        try {
            await this.service.refresh();
        } catch (error) {
            this.report(error);
        }
    }

    dispose(): void {
        this.service.removeListener('change', this.changeListener);
        this.service.setVisible(false);
        this.panel?.dispose();
    }

    private async handleMessage(message: PortsWebviewMessage): Promise<void> {
        if (!message || typeof message.type !== 'string') { return; }
        if (message.type === 'ready') {
            this.postCurrentState();
            await this.refresh();
        } else if (message.type === 'refresh'
            && Number.isInteger(message.generation)
            && message.generation === this.service.state.generation) {
            await this.refresh();
        }
    }

    private postCurrentState(): void {
        if (!this.panel?.visible) { return; }
        const state = this.service.state;
        if (!this.lifecycle.connected) {
            this.post({ type: 'reset', generation: state.generation });
            this.post({ type: 'state', state: 'noSession', message: 'No active emulator session' });
            return;
        }
        if (!this.service.available) {
            this.post({
                type: 'state', state: 'unsupported',
                message: `v6emul ${this.lifecycle.serverInfo?.emulatorVersion ?? 'unknown'} does not support bulk port statistics`,
            });
            return;
        }
        this.post({
            type: 'snapshot',
            model: {
                generation: state.generation,
                ports: state.ports,
                changed: state.changed,
                errors: state.errors,
            },
        });
        this.post({
            type: 'state',
            state: this.lifecycle.running ? 'running' : state.synchronizing ? 'loading' : 'ready',
            message: this.lifecycle.running
                ? 'Running; values refresh when paused'
                : state.synchronizing ? 'Synchronizing...' : 'Paused',
        });
    }

    private report(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`ports: ${message}`);
        this.post({ type: 'state', state: 'error', message });
        void vscode.window.showErrorMessage(`Ports: ${message}`);
    }

    private post(message: PortsHostMessage): void { void this.panel?.webview.postMessage(message); }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'ports.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'ports.js'));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cssUri}"><title>Ports</title></head>
<body><header><h1>Ports</h1><div id="status" role="status">No active emulator session</div></header>
<main><section><h2>In</h2><div id="ports-in" class="ports"></div></section><section><h2>Out</h2><div id="ports-out" class="ports"></div></section></main>
<script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}