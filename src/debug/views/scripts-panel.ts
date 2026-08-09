import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { ScriptInput, ScriptSnapshot } from '../../emulator/protocol/debug-models';
import { Logger } from '../../platform/logging/logger';
import { ScriptService } from '../scripts/script-service';
import { MAX_SCRIPTS_QUERY_LENGTH } from './scripts-query';
import { ScriptField, ScriptsHostMessage, ScriptsWebviewMessage } from './scripts-messages';

export const SCRIPTS_PANEL_ID = 'v6.scripts';
export const CMD_REFRESH_SCRIPTS = 'v6.refreshScripts';
export const CMD_ADD_SCRIPT = 'v6.addScript';
const WORKSPACE_STATE_KEY = 'v6.scripts.query';

export class ScriptsPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private pollTimer: ReturnType<typeof setInterval> | undefined;
    private readonly stateListener: () => void;
    private readonly changeListener: () => void;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: EmulatorLifecycle,
        private readonly service: ScriptService,
        private readonly workspaceState: vscode.Memento,
        private readonly logger: Logger,
        private readonly onOpenStateChanged: (open: boolean) => void = () => {},
    ) {
        this.stateListener = () => void this.syncSession();
        this.changeListener = () => this.postSnapshot();
        this.lifecycle.on('stateChange', this.stateListener);
        this.service.on('change', this.changeListener);
    }

    toggle(): void { this.panel ? this.panel.dispose() : this.open(); }
    isOpen(): boolean { return this.panel !== undefined; }
    close(): void { this.panel?.dispose(); }
    add(): void { this.post({ type: 'beginAdd' }); }

    open(): void {
        if (this.panel) { this.panel.reveal(); return; }
        const assetsUri = vscode.Uri.joinPath(this.extensionUri, 'src', 'debug', 'views', 'assets');
        const panel = vscode.window.createWebviewPanel(
            SCRIPTS_PANEL_ID, 'Scripts', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [assetsUri], retainContextWhenHidden: true },
        );
        this.panel = panel;
        panel.webview.html = this.html(panel.webview, assetsUri);
        panel.webview.onDidReceiveMessage((message: ScriptsWebviewMessage) => void this.handleMessage(message));
        panel.onDidChangeViewState(event => {
            if (event.webviewPanel.visible) { void this.syncSession(); }
            else { this.stopPolling(); this.post({ type: 'dismissMenus' }); }
        });
        panel.onDidDispose(() => {
            this.stopPolling();
            this.panel = undefined;
            this.onOpenStateChanged(false);
        });
        this.onOpenStateChanged(true);
    }

    async refresh(): Promise<void> {
        await this.runOperation('refresh', () => this.service.refresh());
    }

    dispose(): void {
        this.stopPolling();
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.service.removeListener('change', this.changeListener);
        this.panel?.dispose();
    }

    private async handleMessage(message: ScriptsWebviewMessage): Promise<void> {
        if (!message || typeof message.type !== 'string') { return; }
        try {
            switch (message.type) {
                case 'ready':
                    this.post({
                        type: 'restoredQuery',
                        value: this.workspaceState.get<string>(WORKSPACE_STATE_KEY) ?? '',
                    });
                    await this.syncSession();
                    break;
                case 'refresh': if (this.current(message)) { await this.refresh(); } break;
                case 'add': if (this.current(message)) {
                    await this.runOperation('add', () => this.service.add(this.input(message.input)));
                } break;
                case 'edit': if (this.current(message) && validId(message.scriptId)) {
                    await this.runOperation('edit', () => this.service.edit(message.scriptId, this.input(message.input)));
                } break;
                case 'setActivity': if (this.current(message) && validId(message.scriptId)
                    && typeof message.active === 'boolean') {
                    await this.runOperation('setActivity', () => this.service.setActivity(message.scriptId, message.active));
                } break;
                case 'compile': if (this.current(message) && validId(message.scriptId)) {
                    await this.runOperation('compile', () => this.service.compile(message.scriptId));
                } break;
                case 'runOnce': if (this.current(message) && validId(message.scriptId)) {
                    await this.runOperation('runOnce', async () => {
                        const result = await this.service.runOnce(message.scriptId);
                        if (!result.succeeded) { throw new Error(result.error ?? result.runtime.error ?? 'Script failed'); }
                        if (result.breakRequested) {
                            this.post({
                                type: 'operation', operation: 'runOnce', ok: true,
                                message: `Script ${message.scriptId} requested a break`,
                            });
                        }
                    });
                } break;
                case 'disable': if (this.current(message) && validId(message.scriptId)) {
                    await this.runOperation('disable', () => this.service.disable(message.scriptId));
                } break;
                case 'disableAll': if (this.current(message)) { await this.disableAll(); } break;
                case 'delete': if (this.current(message) && validId(message.scriptId)) {
                    await this.runOperation('delete', () => this.service.delete(message.scriptId));
                } break;
                case 'deleteAll': if (this.current(message)) { await this.deleteAll(); } break;
                case 'copy': if (this.current(message) && validId(message.scriptId)) {
                    await this.copy(message.scriptId, message.field);
                } break;
                case 'persistQuery': if (typeof message.value === 'string') {
                    await this.workspaceState.update(
                        WORKSPACE_STATE_KEY, message.value.slice(0, MAX_SCRIPTS_QUERY_LENGTH),
                    );
                } break;
            }
        } catch (error) {
            this.report('operation', error);
        }
    }

    private async syncSession(): Promise<void> {
        if (!this.lifecycle.connected) {
            this.stopPolling();
            this.postState('noSession', 'No active emulator session', false, false);
            this.postSnapshot();
            return;
        }
        if (!this.panel?.visible) { return; }
        if (!this.service.available) {
            this.stopPolling();
            this.postState(
                'unsupported',
                `v6emul ${this.lifecycle.serverInfo?.emulatorVersion ?? 'unknown'} does not support script schema 1`,
                false,
                false,
            );
            return;
        }
        this.postState('loading', 'Synchronizing scripts...', false, false);
        try {
            await this.service.refresh();
            this.postReadyState();
            this.startPolling();
        } catch (error) {
            this.report('refresh', error);
        }
    }

    private async runOperation<T>(operation: string, callback: () => Promise<T>): Promise<void> {
        this.postState('loading', 'Applying change...', false, false);
        try {
            await callback();
            this.post({ type: 'operation', operation, ok: true, message: '' });
            this.postReadyState();
        } catch (error) {
            this.report(operation, error);
        }
    }

    private async disableAll(): Promise<void> {
        const count = this.service.snapshot.filter(entry => entry.active).length;
        const confirmed = await vscode.window.showWarningMessage(
            `Disable all ${count} active scripts?`, { modal: true }, 'Disable All',
        );
        if (confirmed === 'Disable All') {
            await this.runOperation('disableAll', () => this.service.disableAll());
        }
    }

    private async deleteAll(): Promise<void> {
        const count = this.service.snapshot.length;
        const confirmed = await vscode.window.showWarningMessage(
            `Delete all ${count} scripts? Script files will not be deleted.`, { modal: true }, 'Delete All',
        );
        if (confirmed === 'Delete All') {
            await this.runOperation('deleteAll', () => this.service.deleteAll());
        }
    }

    private async copy(scriptId: number, field: ScriptField): Promise<void> {
        const entry = this.entry(scriptId);
        const value = field === 'name' ? entry.name
            : field === 'path' ? entry.path
                : field === 'activity' ? (entry.active ? 'Enabled' : 'Disabled')
                    : errorText(entry) ?? 'Compiled Successfully';
        await vscode.env.clipboard.writeText(value);
        this.post({ type: 'operation', operation: 'copy', ok: true, message: 'Copied' });
    }

    private input(value: unknown): ScriptInput {
        if (!value || typeof value !== 'object') { throw new Error('Invalid script input'); }
        const input = value as Record<string, unknown>;
        if (typeof input.name !== 'string') { throw new Error('Name must be a string'); }
        if (typeof input.path !== 'string') { throw new Error('Path must be a string'); }
        if (typeof input.active !== 'boolean') { throw new Error('Activity must be a boolean'); }
        return { name: input.name, path: input.path.replace(/\\/g, '/'), active: input.active };
    }

    private current(message: { generation: number }): boolean {
        return Number.isInteger(message.generation) && message.generation === this.service.sessionGeneration;
    }

    private startPolling(): void {
        this.stopPolling();
        if (this.panel?.visible) {
            this.pollTimer = setInterval(
                () => void this.service.refreshIfChanged().catch(error => this.report('refresh', error)), 1000,
            );
        }
    }

    private stopPolling(): void {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = undefined; }
    }

    private postReadyState(): void {
        const capabilities = this.lifecycle.serverInfo?.capabilities;
        const canMutate = this.service.available
            && (!this.lifecycle.running || capabilities?.scriptMutationsWhileRunning === true);
        const canRunOnce = this.service.available
            && (!this.lifecycle.running || capabilities?.scriptRunOnceWhileRunning === true);
        this.postState(
            this.lifecycle.running ? 'running' : 'ready',
            this.lifecycle.running ? 'Running' : 'Paused',
            canMutate,
            canRunOnce,
        );
    }

    private postState(
        state: 'noSession' | 'unsupported' | 'loading' | 'ready' | 'running' | 'error',
        message: string,
        canMutate: boolean,
        canRunOnce: boolean,
    ): void {
        this.post({ type: 'state', state, message, canMutate, canRunOnce });
    }

    private postSnapshot(): void {
        const limits = this.lifecycle.serverInfo?.capabilities.scriptLimits;
        this.post({
            type: 'snapshot',
            generation: this.service.sessionGeneration,
            entries: this.service.snapshot,
            maxNameBytes: limits?.maxNameBytes ?? 0,
            maxPathBytes: limits?.maxPathBytes ?? 0,
        });
    }

    private entry(scriptId: number): ScriptSnapshot {
        const entry = this.service.snapshot.find(item => item.scriptId === scriptId);
        if (!entry) { throw new Error(`Script ${scriptId} no longer exists`); }
        return entry;
    }

    private report(operation: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`scripts: ${message}`);
        this.post({ type: 'operation', operation, ok: false, message, field: errorField(message) });
        this.postState('error', message, false, false);
    }

    private post(message: ScriptsHostMessage): void { void this.panel?.webview.postMessage(message); }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'scripts.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'scripts.js'));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cssUri}"><title>Scripts</title></head>
<body><div class="toolbar"><input id="query" type="search" maxlength="256" aria-label="Filter scripts by name" placeholder="Filter by name"><span id="count"></span></div>
<div id="status" role="status">No active emulator session</div><div id="table" role="grid" aria-label="Scripts"><div class="header" role="row"><span role="columnheader">Compilation</span><span role="columnheader">Activity</span><span role="columnheader">Name</span><span role="columnheader">Path</span></div><div id="rows"></div></div><div id="empty" tabindex="0">No scripts</div><div id="live" class="sr-only" aria-live="polite"></div>
<div id="menu" role="menu" hidden><button role="menuitem" data-action="copy">Copy</button><button role="menuitem" data-action="add">Add</button><button role="menuitem" data-action="compile">Compile</button><button role="menuitem" data-action="runOnce">Run Once</button><button role="menuitem" data-action="disable">Disable</button><button role="menuitem" data-action="disableAll">Disable All</button><button role="menuitem" data-action="delete">Delete</button><button role="menuitem" data-action="deleteAll">Delete All</button></div>
<script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}

function validId(value: number): boolean {
    return Number.isSafeInteger(value) && value >= 0 && value <= 0x7FFFFFFF;
}

function errorText(entry: ScriptSnapshot): string | undefined {
    if (entry.compilation.status === 'error') { return `Compilation error: ${entry.compilation.error}`; }
    if (entry.runtime.status === 'error') { return `Runtime error: ${entry.runtime.error}`; }
    return undefined;
}

function errorField(message: string): 'name' | 'path' | undefined {
    if (/name/i.test(message)) { return 'name'; }
    if (/path/i.test(message)) { return 'path'; }
    return undefined;
}
