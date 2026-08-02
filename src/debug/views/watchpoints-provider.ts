import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ActiveProjectService } from '../../project/active/active-project-service';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { MemoryService } from '../../emulator/memory/memory-service';
import {
    globalAddressMemoryLocation,
    MEMORY_BANK_SIZE,
    memorySpaceKey,
} from '../../emulator/memory/memory-space';
import { IpcCommand } from '../../emulator/protocol/ipc-commands';
import { WatchpointAddRequest, WatchpointEditRequest, WatchpointEntry } from '../../emulator/protocol/debug-models';
import { Logger } from '../../platform/logging/logger';
import { DebugSymbolService } from '../metadata/debug-symbol-service';
import { evaluateSymbolExpression } from '../utilities/symbol-expression';
import { WatchpointService } from '../watchpoints/watchpoint-service';
import { HexViewerProvider } from './hex-viewer-provider';
import { WatchpointExpressionStore } from './watchpoint-expression-store';
import {
    WatchpointCandidate,
    WatchpointEditCandidate,
    WatchpointsHostMessage,
    WatchpointsWebviewMessage,
} from './watchpoints-messages';

export const WATCHPOINTS_VIEW_ID = 'v6.watchpoints';
export const CMD_REFRESH_WATCHPOINTS = 'v6.refreshWatchpoints';
export const CMD_ADD_WATCHPOINT = 'v6.addWatchpoint';

export class WatchpointsProvider implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private readonly memory: MemoryService;
    private readonly symbols = new DebugSymbolService();
    private readonly addressExpressions = new WatchpointExpressionStore();
    private pollTimer: ReturnType<typeof setInterval> | undefined;
    private readonly stateListener: () => void;
    private readonly changeListener: () => void;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: EmulatorLifecycle,
        private readonly service: WatchpointService,
        private readonly hexViewer: HexViewerProvider,
        private readonly activeProjectService: ActiveProjectService,
        private readonly logger: Logger,
        private readonly onOpenStateChanged: (open: boolean) => void = () => {},
    ) {
        this.memory = new MemoryService(lifecycle.ipcClient, undefined);
        this.stateListener = () => void this.syncSession();
        this.changeListener = () => this.postSnapshot();
        this.lifecycle.on('stateChange', this.stateListener);
        this.service.on('change', this.changeListener);
    }

    toggle(): void {
        if (this.panel) {
            this.panel.dispose();
        } else {
            this.open();
        }
    }

    isOpen(): boolean {
        return this.panel !== undefined;
    }

    close(): void {
        this.panel?.dispose();
    }

    open(): void {
        if (this.panel) {
            this.panel.reveal();
            return;
        }
        const assetsUri = vscode.Uri.joinPath(this.extensionUri, 'src', 'debug', 'views', 'assets');
        const panel = vscode.window.createWebviewPanel(
            'v6.watchpoints', 'Watchpoints', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [assetsUri], retainContextWhenHidden: true },
        );
        this.panel = panel;
        panel.webview.html = this.html(panel.webview, assetsUri);
        panel.webview.onDidReceiveMessage((message: WatchpointsWebviewMessage) => void this.handleMessage(message));
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

    async add(): Promise<void> {
        this.open();
        await this.runOperation('add', async () => {
            const expression = '0';
            const added = await this.service.add({
                globalAddr: 0,
                len: 1,
                value: 0,
                access: 'RW',
                condition: 'ANY',
                type: 'LEN',
                active: true,
                comment: '',
            });
            this.addressExpressions.set(added.id, expression);
            this.postSnapshot();
        });
    }

    showStop(ids: readonly number[], globalAddress?: number): void {
        this.post({ type: 'stop', ids: [...ids] });
        if (globalAddress === undefined) { return; }
        try {
            const location = globalAddressMemoryLocation(globalAddress);
            this.hexViewer.revealRange(location.space, location.offset, location.offset);
        } catch (error) {
            this.logger.debug(`watchpoints: stop address unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    dispose(): void {
        this.stopPolling();
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.service.removeListener('change', this.changeListener);
        this.panel?.dispose();
    }

    private async handleMessage(message: WatchpointsWebviewMessage): Promise<void> {
        if (!message || typeof message.type !== 'string') { return; }
        try {
            switch (message.type) {
                case 'ready': await this.syncSession(); break;
                case 'refresh': if (this.current(message)) { await this.refresh(); } break;
                case 'add': if (this.current(message)) {
                    await this.runOperation('add', async () => {
                        const added = await this.service.add(await this.resolveCandidate(message.candidate));
                        this.addressExpressions.set(added.id, message.candidate.globalAddr);
                        this.postSnapshot();
                    });
                } break;
                case 'edit': if (this.current(message)) {
                    await this.runOperation('edit', async () => {
                        const edited = await this.service.edit(await this.resolveEditCandidate(message.candidate));
                        this.addressExpressions.set(edited.id, message.candidate.globalAddr);
                        this.postSnapshot();
                    });
                } break;
                case 'delete': if (this.current(message) && validId(message.id)) {
                    await this.runOperation('delete', async () => {
                        await this.service.delete(message.id);
                        this.addressExpressions.delete(message.id);
                    });
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
        if (!this.panel?.visible) { return; }
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
        await this.loadSymbols();
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
        if (answer === 'Delete All') {
            await this.runOperation('deleteAll', async () => {
                await this.service.deleteAll();
                this.addressExpressions.clear();
            });
        }
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
        this.hexViewer.open();
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

    private async resolveCandidate(candidate: WatchpointCandidate): Promise<WatchpointAddRequest> {
        const globalAddr = typeof candidate.globalAddr === 'number'
            ? candidate.globalAddr
            : evaluateSymbolExpression(candidate.globalAddr, name => {
                const resolution = this.symbols.resolveSymbol(name);
                if (resolution.kind === 'missing') { throw new Error(`Symbol not found: ${name}`); }
                if (resolution.kind === 'ambiguous') { throw new Error(`Symbol is ambiguous: ${name}`); }
                return resolution.symbol.address;
            });
        return { ...candidate, globalAddr };
    }

    private async resolveEditCandidate(candidate: WatchpointEditCandidate): Promise<WatchpointEditRequest> {
        const { id, ...config } = candidate;
        return { id, ...await this.resolveCandidate(config) };
    }

    private async loadSymbols(): Promise<void> {
        const project = this.activeProjectService.getActiveProject();
        if (!project?.run.debugArtifact) {
            this.symbols.clear();
            return;
        }
        try {
            await this.symbols.load(project.run.debugArtifact, project.run.executable);
        } catch (error) {
            this.symbols.clear();
            this.logger.warn(`watchpoints: debug metadata unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private startPolling(): void {
        this.stopPolling();
        if (this.panel?.visible) {
            this.pollTimer = setInterval(() => void this.service.refreshIfChanged().catch(error => this.report('refresh', error)), 1000);
        }
    }

    private stopPolling(): void {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = undefined; }
    }

    private postSnapshot(): void {
        const generation = this.service.sessionGeneration;
        const entries = this.addressExpressions.decorate(this.service.snapshot, generation);
        this.post({ type: 'snapshot', generation, entries });
    }

    private report(operation: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`watchpoints: ${message}`);
        this.post({ type: 'operation', operation, ok: false, message, field: watchpointErrorField(message) });
        this.post({ type: 'state', state: 'error', message, canMutate: this.service.available });
    }

    private post(message: WatchpointsHostMessage): void { void this.panel?.webview.postMessage(message); }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'watchpoints.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'watchpoints.js'));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cssUri}"><title>Watchpoints</title></head>
<body><div id="status" role="status">No active emulator session</div><div id="table" role="grid" aria-label="V6 Watchpoints">
<div class="header" role="row"><span role="columnheader">Activity</span><span role="columnheader">Global Address</span><span role="columnheader">Access</span><span role="columnheader">Condition</span><span role="columnheader">Value</span><span role="columnheader">Type</span><span role="columnheader">Len</span><span role="columnheader">Comment</span></div>
<div id="rows"></div></div><div id="empty" tabindex="0">No watchpoints</div><div id="preview" role="tooltip" hidden></div><div id="live" class="sr-only" aria-live="polite"></div>
<div id="menu" role="menu" hidden><button role="menuitem" data-action="add">Add</button><button role="menuitem" data-action="reveal">Find in Hex Viewer</button><button role="menuitem" data-action="toggle">Enable</button><button role="menuitem" data-action="delete">Delete</button><button role="menuitem" data-action="disableAll">Disable All</button><button role="menuitem" data-action="deleteAll">Delete All</button></div>
<script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}

function validId(id: number): boolean { return Number.isSafeInteger(id) && id >= 0; }

function watchpointErrorField(message: string): string | undefined {
    if (/globalAddr|Global Address|Symbol|Expression|position/i.test(message)) { return 'globalAddr'; }
    if (/\blen(?:gth)?\b|range exceeds|WORD watchpoints require/i.test(message)) { return 'len'; }
    if (/\bvalue\b/i.test(message)) { return 'value'; }
    if (/\baccess\b/i.test(message)) { return 'access'; }
    if (/\bcondition\b/i.test(message)) { return 'condition'; }
    if (/\btype\b/i.test(message)) { return 'type'; }
    if (/\bactive\b/i.test(message)) { return 'active'; }
    if (/\bcomment\b|UTF-8/i.test(message)) { return 'comment'; }
    return undefined;
}