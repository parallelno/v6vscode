import { PanelHost } from '../../platform/webview/panel-host';
import { webviewDocument } from '../../platform/webview/webview-document';
import { RefreshController } from '../../platform/async/refresh-controller';
import { decodeMemoryEditsMessage } from './pilot-message-codecs';
import * as vscode from 'vscode';
import { errorDiagnostic } from '../../emulator/protocol/protocol-result';
import { SessionCoordinator } from '../../emulator/session/session-coordinator';
import { globalAddressMemoryLocation, memorySpaceLabel } from '../../shared/memory-space';
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
    private readonly host: PanelHost<MemoryEditsWebviewMessage>;
    private get panel(): vscode.WebviewPanel | undefined { return this.host.panel; }
    private disposed = false;
    private readonly refreshController = new RefreshController({
        enabled: () => !this.disposed && this.host?.visible === true && this.lifecycle.connected && this.service.available,
        capture: () => this.currentContinuation(),
        refresh: async current => {
            await this.service.refresh();
            if (current()) { this.postReadyState(); }
        },
        failed: error => this.report('refresh', error), intervalMs: 1000, maxBackoffMs: 8000,
    });
    private readonly stateListener: () => void;
    private readonly changeListener: () => void;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: SessionCoordinator,
        private readonly service: MemoryEditService,
        private readonly hexViewer: HexViewerProvider,
        private readonly workspaceState: vscode.Memento,
        private readonly logger: Logger,
        private readonly onOpenStateChanged: (open: boolean) => void = () => {},
    ) {
        this.host = new PanelHost(extensionUri, MEMORY_EDITS_PANEL_ID, 'Memory Edits', {
            document: (webview, assets, token) => this.html(webview, assets, token),
            decode: decodeMemoryEditsMessage, message: message => this.handleMessage(message),
            visibility: visible => { if (visible) { void this.syncSession(); } else { this.stopPolling();  } },
            closed: () => this.stopPolling(), failed: error => this.report('operation', error),
        }, onOpenStateChanged);
        this.stateListener = () => void this.syncSession();
        this.changeListener = () => this.postSnapshot();
        this.lifecycle.on('stateChange', this.stateListener);
        this.service.on('change', this.changeListener);
    }

    toggle(): void { this.panel ? this.host.close() : this.open(); }
    isOpen(): boolean { return this.panel !== undefined; }
    close(): void { this.host.close(); }

    open(): void { this.host.open(); }

    async refresh(): Promise<void> {
        const current = this.currentContinuation();
        try { await this.refreshController.request(true); }
        catch (error) { if (current()) { this.report('refresh', error); } }
    }

    add(): void { this.post({ type: 'beginAdd' }); }

    dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;
        this.refreshController.dispose();
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.service.removeListener('change', this.changeListener);
        this.host.dispose();
    }

    private async handleMessage(message: MemoryEditsWebviewMessage): Promise<void> {
        const decoded = decodeMemoryEditsMessage(message);
        if (!decoded) { return; }
        message = decoded;
        const current = this.currentContinuation();
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
            if (current()) { this.report('operation', error); }
        }
    }

    private async syncSession(): Promise<void> {
        const current = this.currentContinuation();
        if (!this.lifecycle.connected) {
            this.stopPolling();
            this.post({
                type: 'state', state: 'noSession', message: 'No active emulator session',
                canMutate: false, canRestore: false,
            });
            this.postSnapshot();
            return;
        }
        if (!this.host.visible) { return; }
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
            await this.refreshController.request(true);
            if (!current()) { return; }
            this.postReadyState();
            this.startPolling();
        } catch (error) {
            if (!current()) { return; }
            this.report('refresh', error);
        }
    }

    private async runOperation<T>(operation: string, callback: (current: () => boolean) => Promise<T>): Promise<void> {
        const current = this.currentContinuation();
        if (!current()) { return; }
        try {
            await callback(current);
            if (!current()) { return; }
            this.post({ type: 'operation', operation, ok: true, message: '' });
            this.postReadyState();
        } catch (error) {
            if (!current()) { return; }
            this.report(operation, error);
        }
    }

    private async copy(globalAddr: number, field: 'originalValue' | 'enteredValue' | 'currentValue'): Promise<void> {
        const entry = this.find(globalAddr);
        await vscode.env.clipboard.writeText(`0x${entry[field].toString(16).toUpperCase().padStart(2, '0')}`);
    }

    private async deleteAll(): Promise<void> {
        const current = this.currentContinuation();
        const confirmed = await vscode.window.showWarningMessage(
            'Delete all memory edits?',
            { modal: true },
            'Delete All',
        );
        if (current() && confirmed === 'Delete All') {
            await this.runOperation('deleteAll', () => this.service.deleteAll());
        }
    }

    private async deleteAndRestoreAll(): Promise<void> {
        const current = this.currentContinuation();
        const confirmed = await vscode.window.showWarningMessage(
            'Restore original values and delete all memory edits?',
            { modal: true },
            'Delete and Restore All',
        );
        if (current() && confirmed === 'Delete and Restore All') {
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

    private startPolling(): void { this.refreshController.start(); }
    private stopPolling(): void { this.refreshController.stop(); }

    private currentContinuation(): () => boolean {
        const generation = this.service.sessionGeneration;
        const current = this.host.capture();
        return () => !this.disposed && current() && generation === this.service.sessionGeneration;
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
        this.post({ type: 'operation', operation, ok: false,
            diagnostic: errorDiagnostic(error), message });
        this.post({
            type: 'state', state: 'error', message,
            canMutate: this.service.available,
            canRestore: this.service.available,
        });
    }

    private post(message: MemoryEditsHostMessage): void { this.host.post(message); }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri, token: string): string {
        const tooltip = 'Filter by current byte value. Decimal: 0..255. Hex: $NN, 0xNN, or NNh. Bare digits are decimal. Examples: 42, $2A, 0x2A, 2Ah. Clear the field to show all edits.';
        return webviewDocument(webview, assetsUri, { title: 'Memory Edits', asset: 'memory-edits', token, module: true, body: `<div class="toolbar"><input id="query" type="search" aria-label="Filter by current byte value" title="${tooltip}" placeholder="Filter current value"><span id="count"></span></div>
<div id="status" role="status">No active emulator session</div><div id="table" role="grid" aria-label="Memory Edits"><div class="header" role="row"><span role="columnheader">Address</span><span role="columnheader">Original</span><span role="columnheader">Entered</span><span role="columnheader">Current</span><span role="columnheader">Activity</span><span role="columnheader">Auto-update</span></div><div id="rows"></div></div><div id="empty" tabindex="0">No memory edits</div><div id="live" class="sr-only" aria-live="polite"></div>
<div id="menu" role="menu" hidden><button role="menuitem" data-action="copyOriginal">Copy Original Value</button><button role="menuitem" data-action="copyEntered">Copy Entered Value</button><button role="menuitem" data-action="copyCurrent">Copy Current Value</button><button role="menuitem" data-action="reveal">Find in Hex Viewer</button><button role="menuitem" data-action="disable">Disable</button><button role="menuitem" data-action="restore">Restore Original</button><button role="menuitem" data-action="delete">Delete Entry</button><button role="menuitem" data-action="deleteAndRestore">Delete and Restore</button><button role="menuitem" data-action="deleteAndRestoreAll">Delete and Restore All</button></div>
<div id="list-menu" role="menu" hidden><button role="menuitem" data-action="add">Add</button><button role="menuitem" data-action="disable">Disable</button><button role="menuitem" data-action="disableAll">Disable All</button><button role="menuitem" data-action="delete">Delete</button><button role="menuitem" data-action="deleteAll">Delete All</button><button role="menuitem" data-action="deleteAndRestoreAll">Delete and Restore All</button></div>` });
    }
}

function validAddress(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }

export function memoryEditAddressLabel(globalAddr: number): string {
    const location = globalAddressMemoryLocation(globalAddr);
    return `${memorySpaceLabel(location.space)} / 0x${location.offset.toString(16).toUpperCase().padStart(4, '0')}`;
}