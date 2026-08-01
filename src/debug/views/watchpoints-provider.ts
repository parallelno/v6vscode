import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { MemoryService } from '../../emulator/memory/memory-service';
import {
    globalAddressMemoryLocation,
    MEMORY_BANK_SIZE,
    memorySpaceKey,
} from '../../emulator/memory/memory-space';
import { IpcCommand } from '../../emulator/protocol/ipc-commands';
import { WatchpointEntry } from '../../emulator/protocol/debug-models';
import { Logger } from '../../platform/logging/logger';
import { WatchpointService } from '../watchpoints/watchpoint-service';
import { HexViewerProvider } from './hex-viewer-provider';
import { WatchpointsHostMessage, WatchpointsWebviewMessage } from './watchpoints-messages';

export const WATCHPOINTS_VIEW_ID = 'v6.watchpoints';
export const CMD_REFRESH_WATCHPOINTS = 'v6.refreshWatchpoints';
export const CMD_ADD_WATCHPOINT = 'v6.addWatchpoint';

export class WatchpointsProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private view: vscode.WebviewView | undefined;
    private readonly memory: MemoryService;
    private pollTimer: ReturnType<typeof setInterval> | undefined;
    private readonly stateListener: () => void;
    private readonly changeListener: () => void;
    private pendingAdd = false;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: EmulatorLifecycle,
        private readonly service: WatchpointService,
        private readonly hexViewer: HexViewerProvider,
        private readonly logger: Logger,
    ) {
        this.memory = new MemoryService(lifecycle.ipcClient, undefined);
        this.stateListener = () => void this.syncSession();
        this.changeListener = () => this.postSnapshot();
        this.lifecycle.on('stateChange', this.stateListener);
        this.service.on('change', this.changeListener);
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        const assetsUri = vscode.Uri.joinPath(this.extensionUri, 'src', 'debug', 'views', 'assets');
        view.webview.options = { enableScripts: true, localResourceRoots: [assetsUri] };
        view.webview.html = this.html(view.webview, assetsUri);
        view.webview.onDidReceiveMessage((message: WatchpointsWebviewMessage) => void this.handleMessage(message));
        view.onDidChangeVisibility(() => view.visible ? void this.syncSession() : this.stopPolling());
        view.onDidDispose(() => { this.stopPolling(); this.view = undefined; });
    }

    async refresh(): Promise<void> {
        await this.runOperation('refresh', () => this.service.refresh());
    }

    async add(): Promise<void> {
        this.pendingAdd = true;
        await vscode.commands.executeCommand(`${WATCHPOINTS_VIEW_ID}.focus`);
        this.applyPendingAdd();
    }

    dispose(): void {
        this.stopPolling();
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.service.removeListener('change', this.changeListener);
    }

    private async handleMessage(message: WatchpointsWebviewMessage): Promise<void> {
        if (!message || typeof message.type !== 'string') { return; }
        try {
            switch (message.type) {
                case 'ready': await this.syncSession(); this.applyPendingAdd(); break;
                case 'refresh': if (this.current(message)) { await this.refresh(); } break;
                case 'add': if (this.current(message)) { await this.runOperation('add', () => this.service.add(message.candidate)); } break;
                case 'edit': if (this.current(message)) { await this.runOperation('edit', () => this.service.edit(message.candidate)); } break;
                case 'delete': if (this.current(message) && validId(message.id)) {
                    await this.runOperation('delete', () => this.service.delete(message.id));
                } break;
                case 'disableAll': if (this.current(message)) {
                    await this.runOperation('disableAll', () => this.service.disableAll());
                } break;
                case 'deleteAll': if (this.current(message)) { await this.confirmDeleteAll(); } break;
                case 'preview': if (this.current(message) && validId(message.id)) {
                    await this.preview(message.id).catch(error => {
                        this.logger.warn(`watchpoints: preview unavailable: ${error instanceof Error ? error.message : String(error)}`);
                        this.post({ type: 'preview', id: message.id, text: 'Memory preview unavailable' });
                    });
                } break;
                case 'reveal': if (this.current(message) && validId(message.id)) { await this.reveal(message.id); } break;
            }
        } catch (error) {
            this.report('operation', error);
        }
    }

    private async syncSession(): Promise<void> {
        if (!this.view?.visible) { return; }
        if (!this.lifecycle.connected) {
            this.stopPolling();
            this.memory.setCapabilities(undefined);
            this.post({ type: 'state', state: 'noSession', message: 'No active emulator session', canMutate: false });
            this.postSnapshot();
            return;
        }
        if (!this.service.available) {
            this.stopPolling();
            this.post({
                type: 'state', state: 'unsupported', canMutate: false,
                message: `v6emul ${this.lifecycle.serverInfo?.emulatorVersion ?? 'unknown'} does not support structured watchpoint editing`,
            });
            return;
        }
        this.configureMemory();
        this.post({ type: 'state', state: 'loading', message: 'Synchronizing watchpoints...', canMutate: false });
        try {
            await this.service.refresh();
            const canMutate = !this.lifecycle.running
                || this.lifecycle.serverInfo?.capabilities.watchpointMutationsWhileRunning === true;
            this.post({
                type: 'state', state: this.lifecycle.running ? 'running' : 'ready', canMutate,
                message: this.lifecycle.running ? 'Running' : 'Paused',
            });
            this.startPolling();
        } catch (error) {
            this.report('refresh', error);
        }
    }

    private async runOperation<T>(operation: string, callback: () => Promise<T>): Promise<void> {
        try {
            await callback();
            this.post({ type: 'operation', operation, ok: true, message: '' });
        } catch (error) {
            this.report(operation, error);
        }
    }

    private async confirmDeleteAll(): Promise<void> {
        const count = this.service.snapshot.length;
        const answer = await vscode.window.showWarningMessage(
            `Delete all ${count} backend watchpoints? This also removes watchpoints created by other clients.`,
            { modal: true }, 'Delete All',
        );
        if (answer === 'Delete All') { await this.runOperation('deleteAll', () => this.service.deleteAll()); }
    }

    private async preview(id: number): Promise<void> {
        const entry = this.findEntry(id);
        if (!this.memory.supported) { throw new Error('Memory preview is unavailable'); }
        const start = globalAddressMemoryLocation(entry.globalAddr);
        const length = Math.min(entry.len, 16, MEMORY_BANK_SIZE - start.offset);
        const result = await this.memory.refreshVisible(start.space, start.offset, length);
        const bytes = Array.from(result.values, (value, index) => result.valid[index]
            ? value.toString(16).toUpperCase().padStart(2, '0') : '--');
        const characters = Array.from(result.values, (value, index) => result.valid[index] && value >= 0x20 && value <= 0x7E
            ? String.fromCharCode(value) : '.');
        const suffix = entry.len > 16 ? `... (first 16 of ${entry.len} bytes)` : '';
        this.post({ type: 'preview', id, text: `${bytes.join(' ')}    ${characters.join('')}${suffix}` });
    }

    private async reveal(id: number): Promise<void> {
        const entry = this.findEntry(id);
        const start = globalAddressMemoryLocation(entry.globalAddr);
        const end = globalAddressMemoryLocation(entry.globalAddr + entry.len - 1);
        if (memorySpaceKey(start.space) !== memorySpaceKey(end.space)) {
            throw new Error('Watchpoint range crosses a Hex Viewer memory bank');
        }
        this.hexViewer.revealRange(start.space, start.offset, end.offset);
        await vscode.commands.executeCommand('v6.hexViewer.focus');
    }

    private findEntry(id: number): WatchpointEntry {
        const entry = this.service.snapshot.find(item => item.id === id);
        if (!entry) { throw new Error(`Watchpoint ${id} no longer exists`); }
        return entry;
    }

    private current(message: { generation: number }): boolean {
        return Number.isInteger(message.generation) && message.generation === this.service.sessionGeneration;
    }

    private configureMemory(): void {
        const supported = this.lifecycle.serverInfo?.commands.includes(IpcCommand.GET_MEM) === true;
        this.memory.setCapabilities(supported ? {
            maxReadLength: 16, ramDiskCount: 8, banksPerRamDisk: 4,
            bytesPerBank: MEMORY_BANK_SIZE, coherentWhileRunning: true,
        } : undefined);
    }

    private startPolling(): void {
        this.stopPolling();
        if (this.view?.visible) {
            this.pollTimer = setInterval(() => void this.service.refreshIfChanged().catch(error => this.report('refresh', error)), 1000);
        }
    }

    private stopPolling(): void {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = undefined; }
    }

    private postSnapshot(): void {
        this.post({ type: 'snapshot', generation: this.service.sessionGeneration, entries: this.service.snapshot });
    }

    private applyPendingAdd(): void {
        if (!this.view || !this.pendingAdd) { return; }
        this.pendingAdd = false;
        this.post({ type: 'operation', operation: 'beginAdd', ok: true, message: '' });
    }

    private report(operation: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`watchpoints: ${message}`);
        this.post({ type: 'operation', operation, ok: false, message });
        this.post({ type: 'state', state: 'error', message, canMutate: this.service.available });
    }

    private post(message: WatchpointsHostMessage): void { void this.view?.webview.postMessage(message); }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'watchpoints.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'watchpoints.js'));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cssUri}"><title>V6 Watchpoints</title></head>
<body><div id="status" role="status">No active emulator session</div><div id="table" role="grid" aria-label="V6 Watchpoints">
<div class="header" role="row"><span role="columnheader">Activity</span><span role="columnheader">Global Address</span><span role="columnheader">Access</span><span role="columnheader">Condition</span><span role="columnheader">Value</span><span role="columnheader">Type</span><span role="columnheader">Len</span><span role="columnheader">Comment</span></div>
<div id="rows"></div></div><div id="empty" tabindex="0">No watchpoints</div><div id="preview" role="tooltip" hidden></div><div id="live" class="sr-only" aria-live="polite"></div>
<div id="menu" role="menu" hidden><button role="menuitem" data-action="add">Add</button><button role="menuitem" data-action="reveal">Find in Hex Viewer</button><button role="menuitem" data-action="toggle">Enable</button><button role="menuitem" data-action="delete">Delete</button><button role="menuitem" data-action="disableAll">Disable All</button><button role="menuitem" data-action="deleteAll">Delete All</button></div>
<script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}

function validId(id: number): boolean { return Number.isSafeInteger(id) && id >= 0; }