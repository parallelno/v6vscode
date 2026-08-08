import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { LanguagePresentationService, PresentedLine } from '../../language/language-presentation-service';
import { SourceDocumentContext, SourceSymbolLinkService } from '../../language/symbols/symbol-link-service';
import { Logger } from '../../platform/logging/logger';
import { ActiveProjectService } from '../../project/active/active-project-service';
import { TraceLogService } from '../trace-log/trace-log-service';
import { parseTraceLogQuery } from '../trace-log/trace-log-query';
import { DebugSymbolService } from '../metadata/debug-symbol-service';
import { SourceLocation } from '../metadata/debug-index';
import { resolveDebugSourcePath } from '../metadata/debug-source-path';
import { revealDebugSource } from './debug-source-navigation';
import {
    TraceLogAction,
    TraceLogHostMessage,
    TraceLogRowViewModel,
    TraceLogWebviewMessage,
} from './trace-log-messages';

export const TRACE_LOG_PANEL_ID = 'v6.traceLog';
export const CMD_REFRESH_TRACE_LOG = 'v6.refreshTraceLog';
const WORKSPACE_STATE_KEY = 'v6.traceLog.state';
const QUERY_DELAY_MS = 100;
const MAX_QUERY_LENGTH = 256;

interface PersistedTraceLogState {
    query: string;
    history: string[];
}

interface PreparedRow {
    view: TraceLogRowViewModel;
    source?: SourceLocation;
    presentation: PresentedLine;
}

export class TraceLogPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private queryTimer: ReturnType<typeof setTimeout> | undefined;
    private syncGeneration = 0;
    private sourceContext: SourceDocumentContext | undefined;
    private projectRoot = '';
    private readonly rows = new Map<number, PreparedRow>();
    private readonly stateListener: () => void;
    private readonly breakpointListener: vscode.Disposable;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: EmulatorLifecycle,
        private readonly service: TraceLogService,
        private readonly symbols: DebugSymbolService,
        private readonly presentation: LanguagePresentationService,
        private readonly symbolLinks: SourceSymbolLinkService,
        private readonly activeProjectService: ActiveProjectService,
        private readonly workspaceState: vscode.Memento,
        private readonly logger: Logger,
        private readonly onOpenStateChanged: (open: boolean) => void = () => {},
    ) {
        this.stateListener = () => void this.syncSession();
        this.lifecycle.on('stateChange', this.stateListener);
        this.breakpointListener = vscode.debug.onDidChangeBreakpoints(() => this.postBreakpointStates());
    }

    toggle(): void { this.panel ? this.panel.dispose() : this.open(); }
    isOpen(): boolean { return this.panel !== undefined; }
    close(): void { this.panel?.dispose(); }

    open(): void {
        if (this.panel) { this.panel.reveal(); return; }
        const assetsUri = vscode.Uri.joinPath(this.extensionUri, 'src', 'debug', 'views', 'assets');
        const panel = vscode.window.createWebviewPanel(
            TRACE_LOG_PANEL_ID, 'Trace Log', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [assetsUri], retainContextWhenHidden: true },
        );
        this.panel = panel;
        panel.webview.html = this.html(panel.webview, assetsUri);
        panel.webview.onDidReceiveMessage((message: TraceLogWebviewMessage) => void this.handleMessage(message));
        panel.onDidChangeViewState(event => {
            this.service.setVisible(event.webviewPanel.visible);
            if (event.webviewPanel.visible) { void this.syncSession(); }
            else { this.cancelQuery(); this.rows.clear(); this.post({ type: 'dismissMenus' }); }
        });
        panel.onDidDispose(() => {
            this.cancelQuery();
            this.service.setVisible(false);
            this.rows.clear();
            this.panel = undefined;
            this.onOpenStateChanged(false);
        });
        this.service.setVisible(true);
        this.onOpenStateChanged(true);
    }

    async refresh(): Promise<void> {
        if (!this.panel?.visible) { return; }
        await this.applyQuery(this.persistedState().query);
    }

    dispose(): void {
        this.syncGeneration++;
        this.cancelQuery();
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.breakpointListener.dispose();
        this.service.setVisible(false);
        this.panel?.dispose();
    }

    private async handleMessage(message: TraceLogWebviewMessage): Promise<void> {
        if (!message || typeof message.type !== 'string') { return; }
        try {
            switch (message.type) {
                case 'ready':
                    this.restore();
                    await this.syncSession();
                    break;
                case 'query':
                    if (typeof message.value === 'string') { this.scheduleQuery(message.value); }
                    break;
                case 'visibleRange':
                    if (validGeneration(message.generation) && validIndex(message.start) && validLines(message.lines)) {
                        await this.loadWindow(message.generation, message.start, message.lines);
                    }
                    break;
                case 'persist': await this.persist(message); break;
                case 'action':
                    if (this.current(message.generation) && validIndex(message.index)) {
                        await this.runAction(message.index, message.action);
                    }
                    break;
                case 'link':
                    if (this.current(message.generation) && validIndex(message.index)
                        && validIndex(message.start) && validLines(message.length)) {
                        await this.openLink(message.index, message.start, message.length);
                    }
                    break;
            }
        } catch (error) {
            if (!inactiveError(error)) { this.report(error); }
        }
    }

    private async syncSession(): Promise<void> {
        if (!this.panel) { return; }
        if (!this.lifecycle.connected) {
            this.clear('noSession', 'No active emulator session');
            return;
        }
        if (!this.panel?.visible) { return; }
        this.service.setVisible(true);
        if (this.lifecycle.running) {
            this.clear('running', 'Trace Log is available while the emulator is paused');
            return;
        }
        if (!this.service.available) {
            this.clear(
                'unsupported',
                `v6emul ${this.lifecycle.serverInfo?.emulatorVersion ?? 'unknown'} does not support trace-log schema 1`,
            );
            return;
        }

        const generation = ++this.syncGeneration;
        await this.loadSourceContext();
        if (generation !== this.syncGeneration || !this.panel?.visible || this.lifecycle.running) { return; }
        try {
            await this.applyQuery(this.persistedState().query);
        } catch (error) {
            if (!inactiveError(error)) { this.report(error); }
        }
    }

    private scheduleQuery(value: string): void {
        this.cancelQuery();
        const query = value.slice(0, MAX_QUERY_LENGTH);
        const limits = this.service.limits;
        if (!limits) { return; }
        const parsed = parseTraceLogQuery(query, limits.maxPatternBytes);
        if (!parsed.ok) {
            this.post({ type: 'queryError', message: parsed.error });
            return;
        }
        this.post({ type: 'queryError', message: '' });
        this.queryTimer = setTimeout(() => {
            this.queryTimer = undefined;
            void this.applyQuery(query).catch(error => {
                if (!inactiveError(error)) { this.report(error); }
            });
        }, QUERY_DELAY_MS);
    }

    private async applyQuery(query: string): Promise<void> {
        const limits = this.service.limits;
        if (!limits) { return; }
        const parsed = parseTraceLogQuery(query, limits.maxPatternBytes);
        if (!parsed.ok) { this.post({ type: 'queryError', message: parsed.error }); return; }
        this.rows.clear();
        this.post({ type: 'state', state: 'loading', message: 'Filtering trace log...' });
        const result = await this.service.filter(parsed.request);
        if (result !== this.service.activeFilter) { return; }
        this.post({ type: 'filter', generation: result.generation, totalMatches: result.totalMatches });
        this.post({
            type: 'state',
            state: result.totalMatches ? 'ready' : 'empty',
            message: result.totalMatches ? `${result.totalMatches.toLocaleString()} matching instructions` : 'No matching instructions',
        });
    }

    private async loadWindow(generation: number, start: number, lines: number): Promise<void> {
        if (!this.current(generation)) { return; }
        const window = await this.service.window(start, lines);
        if (!this.current(generation)) { return; }
        const prepared = await Promise.all(window.entries.map((entry, offset) =>
            this.prepareRow(window.start + offset, entry.address, entry.instruction)));
        if (!this.current(generation)) { return; }
        for (const row of prepared) { this.rows.set(row.view.index, row); }
        this.trimRows(window.start, window.entries.length);
        this.post({
            type: 'window', generation, start: window.start,
            rows: prepared.map(row => row.view),
        });
    }

    private async prepareRow(index: number, address: number, instruction: string): Promise<PreparedRow> {
        const source = this.sourceContext ? this.symbols.sourceAtExactAddress(address) : undefined;
        let presented: PresentedLine | undefined;
        if (source && this.sourceContext) {
            try { presented = await this.presentation.presentSourceLine(source, this.sourceContext); }
            catch (error) {
                this.logger.warn(`trace-log: source line unavailable: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        const presentation = presented ?? this.presentation.presentStandaloneLine(instruction);
        const sourceBacked = presented !== undefined;
        const prepared: PreparedRow = {
            source: sourceBacked ? source : undefined,
            presentation,
            view: {
                index,
                address: formatAddress(address),
                listing: presentation.text,
                highlights: presentation.highlights,
                links: sourceBacked
                    ? presentation.links.map(link => ({ start: link.start, length: link.length, name: link.name }))
                    : [],
                sourceBacked,
                breakpoint: this.hasBreakpoint(address, sourceBacked ? source : undefined),
                canToggleBreakpoint: sourceBacked && this.hasActiveV6Session(),
            },
        };
        return prepared;
    }

    private async runAction(index: number, action: TraceLogAction): Promise<void> {
        if (!['copyAddress', 'copyListing', 'toggleBreakpoint', 'findSource'].includes(action)) { return; }
        const row = this.rows.get(index);
        const entry = this.service.entry(index);
        if (!row || !entry) { return; }
        switch (action) {
            case 'copyAddress': await vscode.env.clipboard.writeText(row.view.address); break;
            case 'copyListing': await vscode.env.clipboard.writeText(row.view.listing); break;
            case 'toggleBreakpoint': await this.toggleBreakpoint(entry.address, row.source); break;
            case 'findSource': if (row.source) { await revealDebugSource(row.source, this.projectRoot); } break;
        }
    }

    private async openLink(index: number, start: number, length: number): Promise<void> {
        const row = this.rows.get(index);
        if (!row?.source || !this.sourceContext) { return; }
        const link = row.presentation.links.find(item => item.start === start && item.length === length);
        if (!link) { return; }
        const target = await this.symbolLinks.resolve(row.view.listing, { start, length }, this.sourceContext);
        if (target) { await revealDebugSource(target, this.projectRoot); }
    }

    private async toggleBreakpoint(address: number, source?: SourceLocation): Promise<void> {
        if (!this.hasActiveV6Session()) { return; }
        const existing = this.findBreakpoint(address, source);
        if (existing) {
            await vscode.debug.removeBreakpoints([existing]);
            return;
        }
        if (source) {
            const sourcePath = resolveDebugSourcePath(source.file, this.projectRoot);
            const position = new vscode.Position(Math.max(0, source.line - 1), 0);
            await vscode.debug.addBreakpoints([
                new vscode.SourceBreakpoint(new vscode.Location(vscode.Uri.file(sourcePath), position)),
            ]);
        }
    }

    private findBreakpoint(address: number, source?: SourceLocation): vscode.Breakpoint | undefined {
        if (source) {
            const sourcePath = normalizePath(resolveDebugSourcePath(source.file, this.projectRoot));
            return vscode.debug.breakpoints.find(breakpoint => breakpoint instanceof vscode.SourceBreakpoint
                && normalizePath(breakpoint.location.uri.fsPath) === sourcePath
                && breakpoint.location.range.start.line === source.line - 1);
        }
        return undefined;
    }

    private hasBreakpoint(address: number, source?: SourceLocation): boolean {
        return this.findBreakpoint(address, source) !== undefined;
    }

    private postBreakpointStates(): void {
        const filter = this.service.activeFilter;
        if (!filter) { return; }
        const values: Array<{ index: number; breakpoint: boolean }> = [];
        for (const [index, row] of this.rows) {
            const address = this.service.entry(index)?.address;
            if (address === undefined) { continue; }
            const breakpoint = this.hasBreakpoint(address, row.source);
            row.view.breakpoint = breakpoint;
            row.view.canToggleBreakpoint = row.source !== undefined && this.hasActiveV6Session();
            values.push({ index, breakpoint });
        }
        this.post({ type: 'breakpoints', generation: filter.generation, values });
    }

    private async loadSourceContext(): Promise<void> {
        let project = this.activeProjectService.getActiveProject();
        if (!project) { project = await this.activeProjectService.resolve(); }
        this.projectRoot = project
            ? path.dirname(project.uri.fsPath)
            : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        if (!project?.run.debugArtifact) {
            this.sourceContext = undefined;
            return;
        }
        try {
            await this.symbols.load(project.run.debugArtifact, project.run.executable);
            this.sourceContext = {
                projectRoot: this.projectRoot,
                debugArtifact: project.run.debugArtifact,
                executable: project.run.executable,
            };
        } catch (error) {
            this.sourceContext = undefined;
            this.logger.warn(`trace-log: debug metadata unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private current(generation: number): boolean {
        return this.service.activeFilter?.generation === generation && this.panel?.visible === true;
    }

    private trimRows(currentStart: number, currentLength: number): void {
        const blockSize = Math.max(1, this.service.limits?.maxLines ?? currentLength);
        const minimum = Math.max(0, currentStart - blockSize);
        const maximum = currentStart + currentLength + blockSize;
        for (const index of this.rows.keys()) {
            if (index < minimum || index >= maximum) { this.rows.delete(index); }
        }
    }

    private hasActiveV6Session(): boolean { return vscode.debug.activeDebugSession?.type === 'v6'; }

    private clear(state: 'noSession' | 'unsupported' | 'running', message: string): void {
        this.syncGeneration++;
        this.cancelQuery();
        this.rows.clear();
        this.sourceContext = undefined;
        this.service.invalidate();
        this.post({ type: 'reset' });
        this.post({ type: 'state', state, message });
    }

    private restore(): void { this.post({ type: 'restored', ...this.persistedState() }); }

    private persistedState(): PersistedTraceLogState {
        const state = this.workspaceState.get<Partial<PersistedTraceLogState>>(WORKSPACE_STATE_KEY);
        return {
            query: typeof state?.query === 'string' ? state.query.slice(0, MAX_QUERY_LENGTH) : '',
            history: Array.isArray(state?.history)
                ? state.history.filter(item => typeof item === 'string').map(item => item.slice(0, MAX_QUERY_LENGTH)).slice(-50)
                : [],
        };
    }

    private async persist(message: Extract<TraceLogWebviewMessage, { type: 'persist' }>): Promise<void> {
        if (typeof message.query !== 'string' || !Array.isArray(message.history)) { return; }
        const maxPatternBytes = this.service.limits?.maxPatternBytes ?? 64;
        const history = message.history
            .filter(item => typeof item === 'string')
            .map(item => item.slice(0, MAX_QUERY_LENGTH))
            .filter(item => parseTraceLogQuery(item, maxPatternBytes).ok)
            .slice(-50);
        const query = message.query.slice(0, MAX_QUERY_LENGTH);
        const persistedQuery = parseTraceLogQuery(query, maxPatternBytes).ok
            ? query
            : this.persistedState().query;
        await this.workspaceState.update(WORKSPACE_STATE_KEY, {
            query: persistedQuery, history,
        } satisfies PersistedTraceLogState);
    }

    private report(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`trace-log: ${message}`);
        this.post({ type: 'state', state: 'error', message });
    }

    private cancelQuery(): void {
        if (this.queryTimer) { clearTimeout(this.queryTimer); this.queryTimer = undefined; }
    }

    private post(message: TraceLogHostMessage): void { void this.panel?.webview.postMessage(message); }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'trace-log.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'trace-log.js'));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cssUri}"><title>Trace Log</title></head>
<body><div class="toolbar"><input id="query" type="search" maxlength="256" aria-label="Filter by address and instruction" placeholder="0x10* JMP*"><span id="count"></span></div>
<div id="status" role="status">No active emulator session</div>
<div class="table" role="grid" aria-label="Trace log"><div class="header" role="row"><span role="columnheader">Address</span><span role="columnheader">Listing</span></div><div id="viewport" tabindex="0"><div id="spacer"><div id="rows"></div></div></div></div>
<div id="menu" role="menu" hidden><button role="menuitem" data-action="copyAddress">Copy Address</button><button role="menuitem" data-action="copyListing">Copy Listing</button><button role="menuitemcheckbox" data-action="toggleBreakpoint">Toggle Breakpoint</button><button role="menuitem" data-action="findSource">Find in Source</button></div>
<script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}

function formatAddress(value: number): string { return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`; }
function validGeneration(value: number): boolean { return Number.isSafeInteger(value) && value > 0; }
function validIndex(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function validLines(value: number): boolean { return Number.isSafeInteger(value) && value > 0 && value <= 4096; }
function normalizePath(value: string): string {
    const normalized = path.normalize(value);
    return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}
function inactiveError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('inactive result')
        || message.includes('paused emulator')
        || message.includes('No active emulator session')
        || message.includes('not visible');
}
