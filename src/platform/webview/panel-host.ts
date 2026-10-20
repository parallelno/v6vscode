import * as crypto from 'crypto';
import * as vscode from 'vscode';

export interface PanelCallbacks<M> {
    document(webview: vscode.Webview, assets: vscode.Uri, token: string): string;
    decode(value: unknown): M | undefined;
    message(message: M): Promise<void>;
    visibility(visible: boolean): void;
    closed(): void;
    failed(error: unknown): void;
}

/** Composed host adapter. Feature state/CRUD is deliberately not owned here. */
export class PanelHost<M extends { type: string }> implements vscode.Disposable {
    panel: vscode.WebviewPanel | undefined;
    private ready = false;
    private disposed = false;
    private token = '';
    private readonly subscriptions: vscode.Disposable[] = [];

    constructor(private readonly extensionUri: vscode.Uri, private readonly id: string, private readonly title: string,
        private readonly callbacks: PanelCallbacks<M>, private readonly openChanged: (open: boolean) => void) {}

    get visible(): boolean { return !!this.panel?.visible && this.ready && !this.disposed; }
    capture(): () => boolean {
        const panel = this.panel; const token = this.token;
        return () => !this.disposed && this.panel === panel && this.token === token;
    }

    open(): void {
        if (this.disposed) { return; }
        if (this.panel) { this.panel.reveal(); return; }
        const assets = vscode.Uri.joinPath(this.extensionUri, 'src', 'debug', 'views', 'assets');
        const panel = vscode.window.createWebviewPanel(this.id, this.title, vscode.ViewColumn.Beside, {
            enableScripts: true, retainContextWhenHidden: true,
            localResourceRoots: [assets, vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')],
        });
        this.panel = panel; this.ready = false; this.token = crypto.randomBytes(16).toString('hex');
        const token = this.token;
        this.subscriptions.push(panel.webview.onDidReceiveMessage((value: unknown) => {
            if (this.disposed || this.panel !== panel || !value || typeof value !== 'object'
                || (value as Record<string, unknown>).panelToken !== token) { return; }
            const message = this.callbacks.decode(value);
            if (!message) { return; }
            if (message.type === 'ready') { if (this.ready) { return; } this.ready = true; }
            else if (!this.ready) { return; }
            void this.callbacks.message(message).catch(error => { if (this.panel === panel) { this.callbacks.failed(error); } });
        }), panel.onDidChangeViewState(() => this.callbacks.visibility(this.visible)), panel.onDidDispose(() => {
            if (this.panel !== panel) { return; }
            this.panel = undefined; this.ready = false; this.token = '';
            this.clearSubscriptions(); this.callbacks.closed(); this.openChanged(false);
        }));
        panel.webview.html = this.callbacks.document(panel.webview, assets, token);
        this.openChanged(true);
    }

    post(message: unknown): void { if (!this.disposed && this.ready) { void this.panel?.webview.postMessage(message); } }
    close(): void { this.panel?.dispose(); }
    dispose(): void { if (this.disposed) { return; } this.close(); this.disposed = true; this.clearSubscriptions(); }
    private clearSubscriptions(): void { for (const item of this.subscriptions.splice(0)) { item.dispose(); } }
}