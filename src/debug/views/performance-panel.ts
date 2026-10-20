import { formatHex } from '../../shared/numbers';
import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { errorDiagnostic, diagnosticField } from '../../emulator/protocol/protocol-result';
import { ValidationError } from '../../shared/validation';
import { SessionCoordinator } from '../../emulator/session/session-coordinator';
import { Logger } from '../../platform/logging/logger';
import { ActiveProjectService } from '../../project/active/active-project-service';
import { PerformanceService } from '../performance/performance-service';
import { DebugSymbolService } from '../metadata/debug-symbol-service';
import { CodePerfInput, CodePerfSnapshot } from '../../emulator/protocol/debug-models';
import { evaluateSymbolExpression } from '../utilities/symbol-expression';
import { revealDebugSource } from './debug-source-navigation';
import { EntryExpressionStore } from './entry-expression-store';
import { PerformanceCandidate, PerformanceHostMessage, PerformanceWebviewMessage } from './performance-messages';
import { normalizePerformanceQuery } from './performance-query';

export const PERFORMANCE_PANEL_ID = 'v6.performance';
export const CMD_REFRESH_PERFORMANCE = 'v6.refreshPerformance';
export const CMD_ADD_PERFORMANCE = 'v6.addPerformance';
const WORKSPACE_STATE_KEY = 'v6.performance.query';

export class PerformancePanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private disposed = false;
    private pollTimer: ReturnType<typeof setInterval> | undefined;
    private readonly addressExpressions = new EntryExpressionStore<CodePerfSnapshot, 'addrStart' | 'addrEnd'>(
        ['addrStart', 'addrEnd'],
        (_field, value) => formatAddress(value),
    );
    private readonly projectListener: vscode.Disposable | undefined;
    private readonly stateListener: () => void;
    private readonly changeListener: () => void;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: SessionCoordinator,
        private readonly service: PerformanceService,
        private readonly symbols: DebugSymbolService,
        private readonly activeProjectService: ActiveProjectService,
        private readonly workspaceState: vscode.Memento,
        private readonly logger: Logger,
        private readonly onOpenStateChanged: (open: boolean) => void = () => {},
    ) {
        this.stateListener = () => void this.syncSession();
        this.changeListener = () => this.postSnapshot();
        this.lifecycle.on('stateChange', this.stateListener);
        this.projectListener = this.activeProjectService.onDidChange?.(() => void this.syncSession());
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
            PERFORMANCE_PANEL_ID, 'Performance', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [assetsUri], retainContextWhenHidden: true },
        );
        this.panel = panel;
        panel.webview.html = this.html(panel.webview, assetsUri);
        panel.webview.onDidReceiveMessage((message: PerformanceWebviewMessage) => void this.handleMessage(message));
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
        await this.runOperation('refresh', async current => {
            await this.loadSymbols();
            if (current()) { await this.service.refresh(); }
        });
    }

    dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;
        this.stopPolling();
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.projectListener?.dispose();
        this.service.removeListener('change', this.changeListener);
        this.panel?.dispose();
    }

    private async handleMessage(message: PerformanceWebviewMessage): Promise<void> {
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
                    await this.runOperation('add', async current => {
                        const added = await this.service.add(this.resolveCandidate(message.input));
                        if (!current()) { return; }
                        this.addressExpressions.set(added.id, message.input);
                        this.postSnapshot();
                    });
                } break;
                case 'edit': if (this.current(message) && validId(message.id)) {
                    await this.runOperation('edit', async current => {
                        const edited = await this.service.edit(message.id, this.resolveCandidate(message.input));
                        if (!current()) { return; }
                        this.addressExpressions.set(edited.id, message.input);
                        this.postSnapshot();
                    });
                } break;
                case 'setActivity': if (this.current(message) && validId(message.id)) {
                    await this.runOperation('setActivity', () => this.service.setActivity(message.id, message.active));
                } break;
                case 'disable': if (this.current(message) && validId(message.id)) {
                    await this.runOperation('disable', () => this.service.disable(message.id));
                } break;
                case 'disableAll': if (this.current(message)) {
                    await this.runOperation('disableAll', () => this.service.disableAll());
                } break;
                case 'delete': if (this.current(message) && validId(message.id)) {
                    await this.runOperation('delete', () => this.service.delete(message.id));
                } break;
                case 'deleteAll': if (this.current(message)) { await this.deleteAll(); } break;
                case 'reveal': if (this.current(message) && validId(message.id)) { await this.reveal(message.id); } break;
                case 'persistQuery':
                    await this.workspaceState.update(WORKSPACE_STATE_KEY, normalizePerformanceQuery(message.value));
                    break;
            }
        } catch (error) {
            this.report('operation', error);
        }
    }

    private async syncSession(): Promise<void> {
        const current = this.currentContinuation();
        if (!this.lifecycle.connected) {
            this.stopPolling();
            this.post({ type: 'state', state: 'noSession', message: 'No active emulator session', canMutate: false });
            this.postSnapshot();
            return;
        }
        if (!this.panel?.visible) { return; }
        if (!this.service.available) {
            this.stopPolling();
            this.post({
                type: 'state', state: 'unsupported', canMutate: false,
                message: `v6emul ${this.lifecycle.serverInfo?.emulatorVersion ?? 'unknown'} does not support CodePerf schema 1`,
            });
            return;
        }
        this.post({ type: 'state', state: 'loading', message: 'Synchronizing performance tests...', canMutate: false });
        try {
            await this.loadSymbols();
            if (!current()) { return; }
            await this.service.refresh();
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
        this.post({ type: 'state', state: 'loading', message: 'Applying change...', canMutate: false });
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

    private async deleteAll(): Promise<void> {
        const current = this.currentContinuation();
        const count = this.service.snapshot.length;
        const confirmed = await vscode.window.showWarningMessage(
            `Delete all ${count} performance ${count === 1 ? 'test' : 'tests'}?`, { modal: true }, 'Delete All',
        );
        if (current() && confirmed === 'Delete All') {
            await this.runOperation('deleteAll', () => this.service.deleteAll());
        }
    }

    private async reveal(id: number): Promise<void> {
        const entry = this.service.snapshot.find(item => item.id === id);
        if (!entry) { throw new Error(`Performance test ${id} no longer exists`); }
        const source = this.symbols.sourceAtExactAddress(entry.addrStart);
        if (!source) {
            this.post({
                type: 'state', state: this.lifecycle.running ? 'running' : 'ready', canMutate: this.service.available,
                message: `No DWARF source line for ${formatAddress(entry.addrStart)}`,
            });
            return;
        }
        const project = this.activeProjectService.getActiveProject();
        const projectRoot = project
            ? path.dirname(project.uri.fsPath)
            : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        await revealDebugSource(source, projectRoot);
    }

    private current(message: { generation: number }): boolean {
        return Number.isInteger(message.generation) && message.generation === this.service.sessionGeneration;
    }

    private startPolling(): void {
        this.stopPolling();
        if (this.panel?.visible) {
            this.pollTimer = setInterval(() => {
                const current = this.currentContinuation();
                void this.service.refresh().catch(error => { if (current()) { this.report('refresh', error); } });
            }, 1000);
        }
    }

    private stopPolling(): void {
        if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = undefined; }
    }

    private currentContinuation(): () => boolean {
        const generation = this.service.sessionGeneration;
        const panel = this.panel;
        return () => !this.disposed && this.panel === panel && generation === this.service.sessionGeneration;
    }

    private postReadyState(): void {
        this.post({
            type: 'state', state: this.lifecycle.running ? 'running' : 'ready',
            message: this.lifecycle.running ? 'Running; statistics refresh every second' : 'Paused',
            canMutate: this.service.available,
        });
    }

    private postSnapshot(): void {
        const generation = this.service.sessionGeneration;
        this.post({
            type: 'snapshot', generation,
            entries: this.addressExpressions.decorate(this.service.snapshot, generation),
        });
    }

    private resolveCandidate(candidate: PerformanceCandidate): CodePerfInput {
        return {
            ...candidate,
            addrStart: this.resolveAddress(candidate.addrStart, 'Start address'),
            addrEnd: this.resolveAddress(candidate.addrEnd, 'End address'),
        };
    }

    private resolveAddress(value: string | number, label: string): number {
        if (typeof value === 'number') { return value; }
        if (typeof value !== 'string') { throw new ValidationError(label === 'Start address' ? 'addrStart' : 'addrEnd', `${label}: Expression must be a string`); }
        if (value.length > 256) { throw new ValidationError(label === 'Start address' ? 'addrStart' : 'addrEnd', `${label}: Expression exceeds 256 characters`); }
        try {
            return evaluateSymbolExpression(value, name => this.symbols.requireSymbolAddress(name));
        } catch (error) {
            throw new ValidationError(label === 'Start address' ? 'addrStart' : 'addrEnd', `${label}: ${error instanceof Error ? error.message : String(error)}`, 'expression', error);
        }
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
            this.logger.warn(`performance: debug metadata unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private report(operation: string, error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`performance: ${message}`);
        this.post({ type: 'operation', operation, ok: false,
            diagnostic: errorDiagnostic(error), message, field: performanceErrorField(error) });
        this.post({ type: 'state', state: 'error', message, canMutate: false });
    }

    private post(message: PerformanceHostMessage): void { void this.panel?.webview.postMessage(message); }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'performance.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'performance.js'));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cssUri}"><title>Performance</title></head>
<body><div class="toolbar"><input id="query" type="search" maxlength="256" aria-label="Search performance tests by name" placeholder="Search by name"><span id="count"></span></div>
<div id="status" role="status">No active emulator session</div><div id="table" role="grid" aria-label="Performance tests"><div class="header" role="row"><span role="columnheader">Activity</span><span role="columnheader">Name</span><span role="columnheader">Start</span><span role="columnheader">End</span><span role="columnheader">Statistics</span></div><div id="rows"></div></div><div id="empty" tabindex="0">No performance tests</div><div id="live" class="sr-only" aria-live="polite"></div>
<div id="menu" role="menu" hidden><button role="menuitem" data-action="disable">Disable</button><button role="menuitem" data-action="disableAll">Disable All</button><button role="menuitem" data-action="delete">Delete</button><button role="menuitem" data-action="deleteAll">Delete All</button></div>
<div id="list-menu" role="menu" hidden><button role="menuitem" data-action="add">Add</button><button role="menuitem" data-action="disableAll">Disable All</button><button role="menuitem" data-action="deleteAll">Delete All</button></div>
<script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}

function validId(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 && value <= 0x7FFFFFFF; }
function formatAddress(value: number): string { return formatHex(value, 4); }
function performanceErrorField(error: unknown): 'addrStart' | 'addrEnd' | undefined {
    const field = diagnosticField(error);
    return field === 'addrStart' || field === 'addrEnd' ? field : undefined;
}
