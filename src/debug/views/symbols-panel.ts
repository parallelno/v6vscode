import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { ActiveProjectService } from '../../project/active/active-project-service';
import { Logger } from '../../platform/logging/logger';
import { DebugSymbolService, IndexedSymbol } from '../metadata/debug-symbol-service';
import { revealDebugSource } from './debug-source-navigation';
import { HexViewerProvider } from './hex-viewer-provider';
import { filterSymbols } from './symbols-query';
import { SymbolAction, SymbolsHostMessage, SymbolsWebviewMessage } from './symbols-messages';

export const SYMBOLS_VIEW_ID = 'v6.symbols';
const WORKSPACE_STATE_KEY = 'v6.symbols.state';
const QUERY_DELAY_MS = 75;
const MAX_QUERY_LENGTH = 256;

interface PersistedSymbolsState {
    query: string;
    history: string[];
    matchCase: boolean;
    wholeWord: boolean;
}

export class SymbolsPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private queryTimer: ReturnType<typeof setTimeout> | undefined;
    private syncGeneration = 0;
    private readonly stateListener: (state: string) => void;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: EmulatorLifecycle,
        private readonly activeProjectService: ActiveProjectService,
        private readonly workspaceState: vscode.Memento,
        private readonly symbols: DebugSymbolService,
        private readonly hexViewer: HexViewerProvider,
        private readonly logger: Logger,
        private readonly onOpenStateChanged: (open: boolean) => void = () => {},
    ) {
        this.stateListener = state => {
            if (state === 'stopped') { this.clearSession(); }
        };
        this.lifecycle.on('stateChange', this.stateListener);
    }

    toggle(): void {
        if (this.panel) { this.panel.dispose(); } else { this.open(); }
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
            void this.syncSymbols();
            return;
        }
        const assetsUri = vscode.Uri.joinPath(this.extensionUri, 'src', 'debug', 'views', 'assets');
        const panel = vscode.window.createWebviewPanel(
            SYMBOLS_VIEW_ID, 'Symbols', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [assetsUri], retainContextWhenHidden: true },
        );
        this.panel = panel;
        panel.webview.html = this.html(panel.webview, assetsUri);
        panel.webview.onDidReceiveMessage((message: SymbolsWebviewMessage) => void this.handleMessage(message));
        panel.onDidChangeViewState(event => {
            if (event.webviewPanel.visible) { void this.syncSymbols(); }
        });
        panel.onDidDispose(() => {
            this.cancelQuery();
            this.panel = undefined;
            this.onOpenStateChanged(false);
        });
        this.onOpenStateChanged(true);
    }

    dispose(): void {
        this.syncGeneration++;
        this.cancelQuery();
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.panel?.dispose();
    }

    private async handleMessage(message: SymbolsWebviewMessage): Promise<void> {
        if (!message || typeof message.type !== 'string') { return; }
        try {
            switch (message.type) {
                case 'ready':
                    this.restore();
                    await this.syncSymbols();
                    break;
                case 'query':
                    if (typeof message.value === 'string'
                        && typeof message.matchCase === 'boolean'
                        && typeof message.wholeWord === 'boolean') {
                        this.scheduleQuery(message.value, message.matchCase, message.wholeWord);
                    }
                    break;
                case 'persist':
                    await this.persist(message);
                    break;
                case 'action':
                    if (typeof message.id === 'string') {
                        await this.runAction(message.id, message.action);
                    }
                    break;
            }
        } catch (error) {
            this.report(error);
        }
    }

    private async syncSymbols(): Promise<void> {
        if (!this.lifecycle.connected) {
            this.clearSession();
            return;
        }
        if (!this.panel?.visible) { return; }
        const generation = ++this.syncGeneration;
        let project = this.activeProjectService.getActiveProject();
        if (!project) {
            project = await this.activeProjectService.resolve();
        }
        if (generation !== this.syncGeneration || !this.panel) { return; }
        if (!project) {
            this.symbols.clear();
            this.postResults('', false, false);
            this.post({ type: 'state', state: 'empty', message: 'No active V6 project' });
            return;
        }
        if (!project.run.debugArtifact) {
            this.symbols.clear();
            this.postResults('', false, false);
            this.post({ type: 'state', state: 'empty', message: 'No debug artifact configured for the active project' });
            return;
        }
        this.post({ type: 'state', state: 'loading', message: 'Loading symbols...' });
        try {
            await this.symbols.load(project.run.debugArtifact, project.run.executable);
            if (generation !== this.syncGeneration || !this.panel) { return; }
            const state = this.persistedState();
            this.post({ type: 'state', state: 'ready', message: '' });
            this.postResults(state.query, state.matchCase, state.wholeWord);
        } catch (error) {
            if (generation !== this.syncGeneration) { return; }
            this.symbols.clear();
            this.postResults('', false, false);
            this.report(error);
        }
    }

    private scheduleQuery(value: string, matchCase: boolean, wholeWord: boolean): void {
        this.cancelQuery();
        const query = value.slice(0, MAX_QUERY_LENGTH);
        this.queryTimer = setTimeout(() => {
            this.queryTimer = undefined;
            this.postResults(query, matchCase, wholeWord);
        }, QUERY_DELAY_MS);
    }

    private postResults(query: string, matchCase: boolean, wholeWord: boolean): void {
        const allSymbols = this.symbols.allSymbols();
        const result = filterSymbols(allSymbols, query, { matchCase, wholeWord });
        this.post({
            type: 'results',
            total: allSymbols.length,
            error: result.expressionError,
            items: result.matches.map(symbol => ({
                id: symbol.id,
                name: symbol.name,
                value: formatValue(symbol.address),
                canFindSource: this.symbols.sourceForSymbol(symbol.id) !== undefined,
            })),
        });
    }

    private async runAction(id: string, action: SymbolAction): Promise<void> {
        if (!['copyName', 'copyValue', 'findSource', 'findHex'].includes(action)) { return; }
        const symbol = this.symbols.symbolById(id);
        if (!symbol) { return; }
        switch (action) {
            case 'copyName': await vscode.env.clipboard.writeText(symbol.name); break;
            case 'copyValue': await vscode.env.clipboard.writeText(formatValue(symbol.address)); break;
            case 'findSource': await this.findSource(symbol); break;
            case 'findHex': this.findHex(symbol); break;
        }
    }

    private async findSource(symbol: IndexedSymbol): Promise<void> {
        const source = this.symbols.sourceForSymbol(symbol.id);
        if (!source) {
            this.post({ type: 'state', state: 'ready', message: `No DWARF source line for ${symbol.name}` });
            return;
        }
        const project = this.activeProjectService.getActiveProject();
        const projectRoot = project
            ? path.dirname(project.uri.fsPath)
            : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        await revealDebugSource(source, projectRoot);
    }

    private findHex(symbol: IndexedSymbol): void {
        if (symbol.address < 0 || symbol.address > 0xFFFF) { return; }
        const end = Math.min(0xFFFF, symbol.address + Math.max(1, symbol.size) - 1);
        this.hexViewer.revealSymbol(symbol.name, symbol.address, end);
    }

    private restore(): void {
        const state = this.persistedState();
        this.post({ type: 'restored', ...state });
    }

    private persistedState(): PersistedSymbolsState {
        const state = this.workspaceState.get<Partial<PersistedSymbolsState>>(WORKSPACE_STATE_KEY);
        return {
            query: typeof state?.query === 'string' ? state.query.slice(0, MAX_QUERY_LENGTH) : '',
            history: Array.isArray(state?.history)
                ? state.history.filter(item => typeof item === 'string').map(item => item.slice(0, MAX_QUERY_LENGTH)).slice(-50)
                : [],
            matchCase: state?.matchCase === true,
            wholeWord: state?.wholeWord === true,
        };
    }

    private async persist(message: Extract<SymbolsWebviewMessage, { type: 'persist' }>): Promise<void> {
        if (typeof message.query !== 'string' || !Array.isArray(message.history)
            || typeof message.matchCase !== 'boolean' || typeof message.wholeWord !== 'boolean') { return; }
        await this.workspaceState.update(WORKSPACE_STATE_KEY, {
            query: message.query.slice(0, MAX_QUERY_LENGTH),
            history: message.history.filter(item => typeof item === 'string')
                .map(item => item.slice(0, MAX_QUERY_LENGTH)).slice(-50),
            matchCase: message.matchCase,
            wholeWord: message.wholeWord,
        } satisfies PersistedSymbolsState);
    }

    private report(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`symbols: ${message}`);
        this.post({ type: 'state', state: 'error', message });
    }

    private cancelQuery(): void {
        if (this.queryTimer) { clearTimeout(this.queryTimer); this.queryTimer = undefined; }
    }

    private clearSession(): void {
        this.syncGeneration++;
        this.cancelQuery();
        this.symbols.clear();
        this.postResults('', false, false);
        this.post({ type: 'state', state: 'empty', message: 'No active emulator session' });
    }

    private post(message: SymbolsHostMessage): void {
        void this.panel?.webview.postMessage(message);
    }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'symbols.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'symbols.js'));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><link rel="stylesheet" href="${cssUri}"><title>Symbols</title></head>
<body><div class="toolbar"><input id="query" type="text" maxlength="256" aria-label="Search symbols" placeholder="Name, value, or expression">
<button id="match-case" class="toggle" aria-label="Match Case" aria-pressed="false" title="Match Case">Aa</button>
<button id="whole-word" class="toggle whole-word" aria-label="Match Whole Word" aria-pressed="false" title="Match Whole Word"><span>ab</span></button></div>
<div id="status" role="status">Loading symbols...</div><div id="list" role="list" aria-label="Symbols"></div>
<div id="menu" role="menu" hidden><button role="menuitem" data-action="copyName">Copy Name</button><button role="menuitem" data-action="copyValue">Copy Value</button><button role="menuitem" data-action="findSource">Find in Source</button><button role="menuitem" data-action="findHex">Find in Hex Viewer</button></div>
<script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}

function formatValue(value: number): string {
    return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}