import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { globalAddressMemoryLocation, memorySpaceLabel } from '../../emulator/memory/memory-space';
import { Logger } from '../../platform/logging/logger';
import { MemoryEditService } from '../memory-edits/memory-edit-service';
import { HexViewerProvider } from './hex-viewer-provider';
import { MemoryEditsHostMessage, MemoryEditsWebviewMessage } from './memory-edits-messages';
import { parseMemoryEditQuery } from './memory-edits-query';

export const MEMORY_EDITS_PANEL_ID = 'v6.memoryEdits';
export const CMD_REFRESH_MEMORY_EDITS = 'v6.refreshMemoryEdits';
export const CMD_ADD_MEMORY_EDIT = 'v6.addMemoryEdit';
const WORKSPACE_STATE_KEY = 'v6.memoryEdits.query';

export class MemoryEditsPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private pollTimer: ReturnType<typeof setInterval> | undefined;
    private readonly stateListener: () => void;
    private readonly changeListener: () => void;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: EmulatorLifecycle,
        private readonly service: MemoryEditService,
        private readonly hexViewer: HexViewerProvider,
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

    open(): void {
        if (this.panel) { this.panel.reveal(); return; }
        const assetsUri = vscode.Uri.joinPath(this.extensionUri, 'src', 'debug', 'views', 'assets');
        const panel = vscode.window.createWebviewPanel(
            MEMORY_EDITS_PANEL_ID, 'Memory Edits', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [assetsUri], retainContextWhenHidden: true },
        );
        this.panel = panel;
        panel.webview.html = this.html(panel.webview, assetsUri);
        panel.webview.onDidReceiveMessage((message: MemoryEditsWebviewMessage) => void this.handleMessage(message));
        panel.onDidChangeViewState(event => event.webviewPanel.visible ? void this.syncSession() : this.stopPolling());
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

    add(): void { this.post({ type: 'beginAdd' }); }

    dispose(): void {
        this.stopPolling();
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.service.removeListener('change', this.changeListener);
        this.panel?.dispose();
    }

    private async handleMessage(message: MemoryEditsWebviewMessage): Promise<void> {
        if (!message || typeof message.type !== 'string') { return; }
        try {
            switch (message.type) {
                case 'ready':
                    this.post({ type: 'restoredQuery', value: this.workspaceState.get<string>(WORKSPACE_STATE_KEY) ?? '' });
                    await this.syncSession();
                    break;
                case 'refresh': if (this.current(message)) { await this.refresh(); } break;
                case 'add': if (this.current(message) && validAddress(message.globalAddr)) {
                    await this.runOperation('add', () => this.service.apply(message.globalAddr, message.value));
                } break;
                case 'disable': if (this.current(message) && validAddress(message.globalAddr)) {
                    await this.runOperation('disable', () => this.service.disable(message.globalAddr));
                } break;
                case 'disableAll': if (this.current(message)) {
                    await this.runOperation('disableAll', () => this.service.disableAll());
                } break;
                case 'deleteAll': if (this.current(message)) { await this.deleteAll(); } break;
                case 'deleteAndRestoreAll': if (this.current(message)) { await this.deleteAndRestoreAll(); } break;
                case 'setEntered': if (this.current(message) && validAddress(message.globalAddr)) {
                    await this.runOperation('setEntered', () => this.service.setEnteredValue(message.globalAddr, message.value));
                } break;
                case 'setActivity': if (this.current(message) && validAddress(message.globalAddr)) {
                    await this.runOperation('setActivity', () => this.service.setActivity(message.globalAddr, message.enabled));
                } break;
                case 'setAutoUpdate': if (this.current(message) && validAddress(message.globalAddr)) {
                    await this.runOperation('setAutoUpdate', () => this.service.setAutoUpdate(message.globalAddr, message.enabled));
                } break;
                case 'copy': if (this.current(message) && validAddress(message.globalAddr)) {
                    await this.copy(message.globalAddr, message.field);
                } break;
                case 'reveal': if (this.current(message) && validAddress(message.globalAddr)) {
                    this.reveal(message.globalAddr);
                } break;
                case 'restore': if (this.current(message) && validAddress(message.globalAddr)) {
                    await this.runOperation('restore', () => this.service.restoreRetaining(message.globalAddr));
                } break;
                case 'delete': if (this.current(message) && validAddress(message.globalAddr)) {
                    await this.runOperation('delete', () => this.service.delete(message.globalAddr));
                } break;
                case 'deleteAndRestore': if (this.current(message) && validAddress(message.globalAddr)) {
                    await this.runOperation('deleteAndRestore', () => this.service.deleteAndRestore(message.globalAddr));
                } break;
                case 'persistQuery': {
                    const parsed = parseMemoryEditQuery(message.value);
                    if (parsed.kind !== 'invalid') {
                        await this.workspaceState.update(WORKSPACE_STATE_KEY, message.value.slice(0, 32));
                    }
                } break;
            }
        } catch (error) {
            this.report('operation', error);
        }
    }

    private async syncSession(): Promise<void> {
        if (!this.lifecycle.connected) {
            this.stopPolling();
            this.post({
                type: 'state', state: 'noSession', message: 'No active emulator session',
                canMutate: false, canRestore: false,
            });
            this.postSnapshot();
            return;
        }
        if (!this.panel?.visible) { return; }
        if (!this.service.available) {
            this.stopPolling();
            this.post({
                type: 'state', state: 'unsupported', canMutate: false, canRestore: false,
                message: `v6emul ${this.lifecycle.serverInfo?.emulatorVersion ?? 'unknown'} does not support memory-edit schema 1`,
            });
            return;
        }
        this.post({
            type: 'state', state: 'loading', message: 'Synchronizing memory edits...',
            canMutate: false, canRestore: false,
        });
        try {
            await this.service.refresh();
            this.postReadyState();
            this.startPolling();
        } catch (error) {
            this.report('refresh', error);
        }
    }

    private async runOperation<T>(operation: string, callback: () => Promise<T>): Promise<void> {
        try {
            await callback();
            this.post({ type: 'operation', operation, ok: true, message: '' });
            this.postReadyState();
        } catch (error) {
            this.report(operation, error);
        }
    }

    private async copy(globalAddr: number, field: 'originalValue' | 'enteredValue' | 'currentValue'): Promise<void> {
        const entry = this.find(globalAddr);
        await vscode.env.clipboard.writeText(`0x${entry[field].toString(16).toUpperCase().padStart(2, '0')}`);
    }

    private async deleteAll(): Promise<void> {
        const confirmed = await vscode.window.showWarningMessage(
            'Delete all memory edits?',
            { modal: true },
            'Delete All',
        );
        if (confirmed === 'Delete All') {
            await this.runOperation('deleteAll', () => this.service.deleteAll());
        }
    }

    private async deleteAndRestoreAll(): Promise<void> {
        const confirmed = await vscode.window.showWarningMessage(
            'Restore original values and delete all memory edits?',
            { modal: true },
            'Delete and Restore All',
        );
        if (confirmed === 'Delete and Restore All') {
            await this.runOperation('deleteAndRestoreAll', () => this.service.deleteAndRestoreAll());
        }
    }

    private reveal(globalAddr: number): void {
        this.find(globalAddr);
        const location = globalAddressMemoryLocation(globalAddr);
        this.hexViewer.revealRange(location.space, location.offset, location.offset);
        this.hexViewer.open();
    }

    private find(globalAddr: number) {
        const entry = this.service.snapshot.find(item => item.globalAddr === globalAddr);
        if (!entry) { throw new Error(`Memory edit ${globalAddr} no longer exists`); }
        return entry;
    }

    private current(message: { generation: number }): boolean {
        return Number.isInteger(message.generation) && message.generation === this.service.sessionGeneration;
    }

    private startPolling(): void {
        this.stopPolling();
        if (this.panel?.visible) {
            this.pollTimer = setInterval(() => void this.service.refresh().catch(error => this.report('refresh', error)), 1000);
        }
    }

    private stopPolling(): void {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = undefined; }
    }

    private postReadyState(): void {
        this.post({
            type: 'state', state: this.lifecycle.running ? 'running' : 'ready',
            message: this.lifecycle.running ? 'Running; live values refresh every second' : 'Paused',
            canMutate: this.service.available,
            canRestore: this.service.available,
        });
    }

    private postSnapshot(): void {
        this.post({
            type: 'snapshot', generation: this.service.sessionGeneration,
            entries: this.service.snapshot.map(entry => ({ ...entry })),
        });
    }

    private report(operation: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`memory-edits: ${message}`);
        this.post({ type: 'operation', operation, ok: false, message });
        this.post({
            type: 'state', state: 'error', message,
            canMutate: this.service.available,
            canRestore: this.service.available,
        });
    }

    private post(message: MemoryEditsHostMessage): void { void this.panel?.webview.postMessage(message); }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'memory-edits.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'memory-edits.js'));
        const tooltip = 'Filter by current byte value. Decimal: 0..255. Hex: $NN, 0xNN, or NNh. Bare digits are decimal. Examples: 42, $2A, 0x2A, 2Ah. Clear the field to show all edits.';
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cssUri}"><title>Memory Edits</title></head>
<body><div class="toolbar"><input id="query" type="search" aria-label="Filter by current byte value" title="${tooltip}" placeholder="Filter current value"><span id="count"></span></div>
<div id="status" role="status">No active emulator session</div><div id="table" role="grid" aria-label="Memory Edits"><div class="header" role="row"><span role="columnheader">Address</span><span role="columnheader">Original</span><span role="columnheader">Entered</span><span role="columnheader">Current</span><span role="columnheader">Activity</span><span role="columnheader">Auto-update</span></div><div id="rows"></div></div><div id="empty" tabindex="0">No memory edits</div><div id="live" class="sr-only" aria-live="polite"></div>
<div id="menu" role="menu" hidden><button role="menuitem" data-action="copyOriginal">Copy Original Value</button><button role="menuitem" data-action="copyEntered">Copy Entered Value</button><button role="menuitem" data-action="copyCurrent">Copy Current Value</button><button role="menuitem" data-action="reveal">Find in Hex Viewer</button><button role="menuitem" data-action="disable">Disable</button><button role="menuitem" data-action="restore">Restore Original</button><button role="menuitem" data-action="delete">Delete Entry</button><button role="menuitem" data-action="deleteAndRestore">Delete and Restore</button><button role="menuitem" data-action="deleteAndRestoreAll">Delete and Restore All</button></div>
<div id="list-menu" role="menu" hidden><button role="menuitem" data-action="add">Add</button><button role="menuitem" data-action="disable">Disable</button><button role="menuitem" data-action="disableAll">Disable All</button><button role="menuitem" data-action="delete">Delete</button><button role="menuitem" data-action="deleteAll">Delete All</button><button role="menuitem" data-action="deleteAndRestoreAll">Delete and Restore All</button></div>
<script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}

function validAddress(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }

export function memoryEditAddressLabel(globalAddr: number): string {
    const location = globalAddressMemoryLocation(globalAddr);
    return `${memorySpaceLabel(location.space)} / 0x${location.offset.toString(16).toUpperCase().padStart(4, '0')}`;
}