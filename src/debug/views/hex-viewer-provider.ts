import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActiveProjectService } from '../../project/active/active-project-service';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { IpcClient } from '../../emulator/client/ipc-client';
import { MemoryService } from '../../emulator/memory/memory-service';
import {
    allMemorySpaces,
    isValidMemorySpace,
    MAIN_MEMORY_SPACE,
    MEMORY_BANK_SIZE,
    MemorySpace,
    memorySpaceKey,
    memorySpaceLabel,
} from '../../emulator/memory/memory-space';
import { MemoryReadCapabilities } from '../../emulator/protocol/memory-models';
import { IpcCommand } from '../../emulator/protocol/ipc-commands';
import { DebugSymbolService } from '../metadata/debug-symbol-service';
import { evaluateSymbolExpression } from '../utilities/symbol-expression';
import { Logger } from '../../platform/logging/logger';
import { parseHexQuery, ParsedLocation } from './hex-viewer-query';
import { HexViewerHostMessage, HexViewerWebviewMessage } from './hex-viewer-messages';
import { revealDebugSource } from './debug-source-navigation';

export const HEX_VIEWER_VIEW_ID = 'v6.hexViewer';
export const CMD_REFRESH_HEX_VIEWER = 'v6.refreshHexViewer';
const WORKSPACE_STATE_KEY = 'v6.hexViewer.state';
const QUERY_DELAY_MS = 75;

interface PersistedHexViewerState {
    space: MemorySpace;
    query: string;
    history: string[];
}

interface VisibleRange {
    space: MemorySpace;
    offset: number;
    length: number;
}

export class HexViewerProvider implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private readonly memory: MemoryService;
    private visibleRange: VisibleRange | undefined;
    private selectedSpace: MemorySpace = MAIN_MEMORY_SPACE;
    private refreshTimer: ReturnType<typeof setInterval> | undefined;
    private queryTimer: ReturnType<typeof setTimeout> | undefined;
    private refreshActive = false;
    private pendingRefresh: VisibleRange | undefined;
    private readonly stateListener: () => void;
    private pendingNavigation: {
        space: MemorySpace;
        start: number;
        end: number;
        query?: string;
        commitHistory?: boolean;
    } | undefined;
    private webviewReady = false;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: EmulatorLifecycle,
        client: IpcClient,
        private readonly activeProjectService: ActiveProjectService,
        private readonly workspaceState: vscode.Memento,
        private readonly logger: Logger,
        private readonly onOpenStateChanged: (open: boolean) => void = () => {},
        private readonly symbols: DebugSymbolService = new DebugSymbolService(),
    ) {
        this.memory = new MemoryService(client, undefined);
        this.stateListener = () => void this.syncSession();
        this.lifecycle.on('stateChange', this.stateListener);
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
            'v6.hexViewer', 'Hex Viewer', vscode.ViewColumn.Beside,
            { enableScripts: true, localResourceRoots: [assetsUri], retainContextWhenHidden: true },
        );
        this.panel = panel;
        this.webviewReady = false;
        panel.webview.html = this.html(panel.webview, assetsUri);
        panel.webview.onDidReceiveMessage((message: HexViewerWebviewMessage) => void this.handleMessage(message));
        panel.onDidChangeViewState(event => {
            if (event.webviewPanel.visible) {
                void this.syncSession();
            } else {
                this.stopRefreshTimer();
            }
        });
        panel.onDidDispose(() => {
            this.stopRefreshTimer();
            this.panel = undefined;
            this.webviewReady = false;
            this.onOpenStateChanged(false);
        });
        this.onOpenStateChanged(true);
    }

    async refresh(): Promise<void> {
        if (this.visibleRange && this.panel?.visible) {
            await this.refreshVisible(this.visibleRange);
        }
    }

    revealRange(space: MemorySpace, start: number, end: number): void {
        if (!isValidMemorySpace(space) || !Number.isInteger(start) || !Number.isInteger(end)
            || start < 0 || end < start || end >= MEMORY_BANK_SIZE) {
            throw new RangeError('Hex Viewer range is invalid');
        }
        this.selectedSpace = space;
        this.pendingNavigation = { space, start, end };
        this.applyPendingNavigation();
    }

    revealSymbol(name: string, start: number, end: number): void {
        if (!name || !Number.isInteger(start) || !Number.isInteger(end)
            || start < 0 || end < start || end >= MEMORY_BANK_SIZE) {
            throw new RangeError('Hex Viewer symbol navigation is invalid');
        }
        this.selectedSpace = MAIN_MEMORY_SPACE;
        this.pendingNavigation = {
            space: MAIN_MEMORY_SPACE,
            start,
            end,
            query: name.slice(0, 256),
            commitHistory: true,
        };
        this.open();
        this.applyPendingNavigation();
    }

    dispose(): void {
        this.stopRefreshTimer();
        if (this.queryTimer) { clearTimeout(this.queryTimer); }
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.panel?.dispose();
    }

    private async handleMessage(message: HexViewerWebviewMessage): Promise<void> {
        if (!message || typeof message.type !== 'string') { return; }
        try {
            switch (message.type) {
                case 'ready':
                    this.webviewReady = true;
                    await this.restore();
                    await this.syncSession();
                    this.applyPendingNavigation();
                    break;
                case 'visibleRange':
                    if (!this.validVisibleRange(message)) { return; }
                    this.visibleRange = { space: message.space, offset: message.offset, length: message.length };
                    await this.refreshVisible(this.visibleRange);
                    break;
                case 'selectSpace':
                    if (!isValidMemorySpace(message.space) || !this.spaceSupported(message.space)) { return; }
                    this.selectedSpace = message.space;
                    this.visibleRange = undefined;
                    break;
                case 'query':
                    this.scheduleQuery(message.value);
                    break;
                case 'editByte':
                    await this.editByte(message);
                    break;
                case 'copy':
                    await this.copy(message);
                    break;
                case 'findSource':
                    await this.findSource(message.space, message.address);
                    break;
                case 'persist':
                    if (isValidMemorySpace(message.space)) {
                        await this.workspaceState.update(WORKSPACE_STATE_KEY, {
                            space: message.space,
                            query: String(message.query).slice(0, 256),
                            history: message.history.filter(item => typeof item === 'string').slice(-50),
                        } satisfies PersistedHexViewerState);
                    }
                    break;
            }
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            this.logger.error(`hex-viewer: ${messageText}`);
            this.post({ type: 'state', state: 'error', message: messageText });
        }
    }

    private async syncSession(): Promise<void> {
        if (!this.lifecycle.connected) {
            this.memory.setCapabilities(undefined);
            this.stopRefreshTimer();
            if (this.queryTimer) {
                clearTimeout(this.queryTimer);
                this.queryTimer = undefined;
            }
            this.visibleRange = undefined;
            this.post({ type: 'reset' });
            this.post({ type: 'state', state: 'noSession', message: 'No active emulator session' });
            return;
        }
        if (!this.panel?.visible) { return; }

        const capabilities = this.memoryCapabilities();
        this.memory.setCapabilities(capabilities);
        if (!this.memory.supported) {
            this.stopRefreshTimer();
            const version = this.lifecycle.serverInfo?.emulatorVersion ?? 'unknown';
            this.post({
                type: 'state',
                state: 'unsupported',
                message: `v6emul ${version} does not support GET_MEM global memory reads`,
            });
            return;
        }

        await this.loadSymbols();
        if (!this.lifecycle.connected || !this.memory.supported) {
            return;
        }
        const spaces = allMemorySpaces(capabilities!.ramDiskCount, capabilities!.banksPerRamDisk);
        if (!spaces.some(space => memorySpaceKey(space) === memorySpaceKey(this.selectedSpace))) {
            this.selectedSpace = MAIN_MEMORY_SPACE;
        }
        this.post({
            type: 'spaces',
            spaces: spaces.map(space => ({ space, label: memorySpaceLabel(space) })),
            selected: this.selectedSpace,
        });
        this.post({
            type: 'editing',
            enabled: this.lifecycle.serverInfo?.commands.includes(IpcCommand.SET_BYTE_GLOBAL) === true,
        });
        this.post({
            type: 'state',
            state: this.lifecycle.running ? 'running' : 'ready',
            message: this.lifecycle.running ? 'Live; refreshes every second' : 'Paused',
        });
        this.configureRefreshTimer();
        await this.refresh();
    }

    private memoryCapabilities(): MemoryReadCapabilities | undefined {
        const info = this.lifecycle.serverInfo;
        if (!info || !info.commands.includes(IpcCommand.GET_MEM)) {
            return undefined;
        }
        return {
            maxReadLength: MEMORY_BANK_SIZE,
            ramDiskCount: 8,
            banksPerRamDisk: 4,
            bytesPerBank: MEMORY_BANK_SIZE,
            coherentWhileRunning: true,
        };
    }

    private async refreshVisible(range: VisibleRange): Promise<void> {
        if (!this.panel?.visible || !this.lifecycle.connected || !this.memory.supported) { return; }
        if (this.refreshActive) {
            this.pendingRefresh = range;
            return;
        }
        this.refreshActive = true;
        try {
            await this.executeRefresh(range);
        } finally {
            this.refreshActive = false;
            const pending = this.pendingRefresh;
            this.pendingRefresh = undefined;
            if (pending && this.panel?.visible) {
                void this.refreshVisible(pending);
            }
        }
    }

    private async executeRefresh(range: VisibleRange): Promise<void> {
        const capabilities = this.memory.memoryCapabilities!;
        if (this.lifecycle.running && !capabilities.coherentWhileRunning) {
            const cached = this.memory.readCached(range.space, range.offset, range.length);
            this.postMemory(range, cached.values, cached.valid);
            this.post({ type: 'state', state: 'stale', message: 'Running; showing the last coherent values' });
            return;
        }
        const cached = await this.memory.refreshVisible(range.space, range.offset, range.length);
        this.postMemory(range, cached.values, cached.valid);
    }

    private postMemory(range: VisibleRange, values: Uint8Array, valid: Uint8Array): void {
        const symbols = range.space.kind === 'main'
            ? this.symbols.symbolsInRange(range.offset, range.offset + range.length - 1)
                .map(symbol => ({ name: symbol.name, address: symbol.address, size: symbol.size }))
            : [];
        const sourceAddresses: number[] = [];
        if (range.space.kind === 'main') {
            for (let address = range.offset; address < range.offset + range.length; address++) {
                if (this.symbols.sourceAtExactAddress(address)) {
                    sourceAddresses.push(address);
                }
            }
        }
        this.post({ type: 'memory', space: range.space, offset: range.offset, values, valid, symbols, sourceAddresses });
    }

    private scheduleQuery(value: string): void {
        if (this.queryTimer) { clearTimeout(this.queryTimer); }
        const parsed = parseHexQuery(value);
        if (parsed.kind === 'invalid') {
            this.post({ type: 'queryError', message: parsed.message });
            return;
        }
        if (parsed.kind === 'empty') {
            this.post({ type: 'clearHighlight' });
            this.post({ type: 'queryError', message: '' });
            return;
        }
        this.post({ type: 'queryError', message: '' });
        this.queryTimer = setTimeout(() => {
            this.queryTimer = undefined;
            const resolved = parsed.kind === 'location'
                ? this.resolveLocation(parsed.location)
                : this.resolveRange(parsed.start, parsed.end);
            if (typeof resolved === 'string') {
                this.post({ type: 'queryError', message: resolved });
            } else {
                this.post({ type: 'navigate', start: resolved.start, end: resolved.end });
            }
        }, QUERY_DELAY_MS);
    }

    private resolveRange(start: ParsedLocation, end: ParsedLocation): { start: number; end: number } | string {
        const startAddress = this.resolveLocation(start);
        if (typeof startAddress === 'string') { return startAddress; }
        const endAddress = this.resolveLocation(end);
        if (typeof endAddress === 'string') { return endAddress; }
        if (startAddress.start > endAddress.start) { return 'Range start must not exceed range end'; }
        return { start: startAddress.start, end: endAddress.start };
    }

    private resolveLocation(location: ParsedLocation): { start: number; end: number } | string {
        if (location.kind === 'address') {
            return { start: location.value, end: location.value };
        }
        const resolveSymbol = (name: string): number => {
            if (this.selectedSpace.kind !== 'main') { throw new Error('Symbols are available only in Main RAM'); }
            const resolution = this.symbols.resolveSymbol(name);
            if (resolution.kind === 'missing') { throw new Error(`Symbol not found: ${name}`); }
            if (resolution.kind === 'ambiguous') { throw new Error(`Symbol is ambiguous: ${name}`); }
            return resolution.symbol.address;
        };
        if (location.kind === 'symbol') {
            try {
                const start = resolveSymbol(location.name);
                const resolution = this.symbols.resolveSymbol(location.name);
                const size = resolution.kind === 'found' ? resolution.symbol.size : 1;
                return { start, end: Math.min(0xFFFF, start + Math.max(1, size) - 1) };
            } catch (error) { return error instanceof Error ? error.message : String(error); }
        }
        try {
            const address = evaluateSymbolExpression(location.value, resolveSymbol);
            return address >= 0 && address <= 0xFFFF
                ? { start: address, end: address }
                : `Address is outside 0x0000..0xFFFF: ${location.value}`;
        } catch (error) { return error instanceof Error ? error.message : String(error); }
    }

    private async copy(message: Extract<HexViewerWebviewMessage, { type: 'copy' }>): Promise<void> {
        if (!this.validAddress(message.space, message.address)) { return; }
        const value = message.target === 'byte'
            ? /^[0-9A-F]{2}$/.test(message.value) ? message.value : undefined
            : message.value.slice(0, 512);
        if (value !== undefined) {
            await vscode.env.clipboard.writeText(value);
        }
    }

    private async editByte(message: Extract<HexViewerWebviewMessage, { type: 'editByte' }>): Promise<void> {
        if (!this.validAddress(message.space, message.address)
            || memorySpaceKey(message.space) !== memorySpaceKey(this.selectedSpace)) {
            return;
        }
        try {
            if (this.lifecycle.serverInfo?.commands.includes(IpcCommand.SET_BYTE_GLOBAL) !== true) {
                throw new Error('The active v6emul does not support global memory writes');
            }
            const value = evaluateSymbolExpression(message.expression, name => {
                const resolution = this.symbols.resolveSymbol(name);
                if (resolution.kind === 'missing') { throw new Error(`Symbol not found: ${name}`); }
                if (resolution.kind === 'ambiguous') { throw new Error(`Symbol is ambiguous: ${name}`); }
                return resolution.symbol.address;
            });
            if (value < 0 || value > 0xFF) {
                throw new Error('Byte value must be an integer from 0 to 255');
            }
            await this.memory.writeByte(message.space, message.address, value);
            this.post({ type: 'byteEdit', space: message.space, address: message.address, ok: true, value, message: '' });
        } catch (error) {
            this.post({
                type: 'byteEdit', space: message.space, address: message.address, ok: false,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async findSource(space: MemorySpace, address: number): Promise<void> {
        if (space.kind !== 'main' || !this.validAddress(space, address)) { return; }
        const source = this.symbols.sourceAtExactAddress(address);
        if (!source) { return; }
        const project = this.activeProjectService.getActiveProject();
        const projectRoot = project
            ? path.dirname(project.uri.fsPath)
            : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        await revealDebugSource(source, projectRoot);
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
            this.logger.warn(`hex-viewer: debug metadata unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async restore(): Promise<void> {
        const state = this.workspaceState.get<PersistedHexViewerState>(WORKSPACE_STATE_KEY);
        if (state && isValidMemorySpace(state.space)) {
            this.selectedSpace = state.space;
        }
        this.post({
            type: 'restored',
            space: this.selectedSpace,
            query: state?.query ?? '',
            history: state?.history ?? [],
        });
    }

    private configureRefreshTimer(): void {
        this.stopRefreshTimer();
        if (this.lifecycle.running && this.panel?.visible) {
            this.refreshTimer = setInterval(() => void this.refresh(), 1000);
        }
    }

    private stopRefreshTimer(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }
        this.pendingRefresh = undefined;
    }

    private validVisibleRange(message: Extract<HexViewerWebviewMessage, { type: 'visibleRange' }>): boolean {
        return this.spaceSupported(message.space)
            && Number.isInteger(message.offset)
            && Number.isInteger(message.length)
            && message.offset >= 0
            && message.length > 0
            && message.offset + message.length <= MEMORY_BANK_SIZE;
    }

    private validAddress(space: MemorySpace, address: number): boolean {
        return isValidMemorySpace(space) && Number.isInteger(address) && address >= 0 && address < MEMORY_BANK_SIZE;
    }

    private spaceSupported(space: MemorySpace): boolean {
        if (!isValidMemorySpace(space) || !this.memory.supported) { return false; }
        const capabilities = this.memory.memoryCapabilities!;
        return space.kind === 'main'
            || (space.disk <= capabilities.ramDiskCount && space.bank < capabilities.banksPerRamDisk);
    }

    private post(message: HexViewerHostMessage): void {
        void this.panel?.webview.postMessage(message);
    }

    private applyPendingNavigation(): void {
        if (!this.panel || !this.webviewReady || !this.pendingNavigation) { return; }
        const navigation = this.pendingNavigation;
        this.pendingNavigation = undefined;
        this.post({ type: 'navigate', ...navigation });
    }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'hex-viewer.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'hex-viewer.js'));
        return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${cssUri}"><title>Hex Viewer</title></head>
<body class="session-empty"><div class="controls"><input id="query" type="text" aria-label="Address expression or inclusive range" placeholder="Symbol + offset, or start..end" title="Address expressions: decimal (256), 0x hex (0x100), $ hex ($100), h suffix (100h), or Main RAM symbols. Operators: +, -, *, unary +/-, and parentheses; multiplication has precedence. Examples: set_palette+1, set_palette+0x10*3. Inclusive ranges use start..end, for example buffer+2..buffer_end-1. Legacy numeric ranges such as 11-14 are also accepted. Bare symbols highlight the complete symbol; expressions highlight one address. Results update while you type.">
<select id="space" aria-label="Memory bank"><option>Main RAM</option></select></div>
<div id="status" role="status">No active emulator session</div>
<div id="header" aria-hidden="true"><span>ADDR</span><span>00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F</span><span>Symbols</span></div>
<div id="viewport" role="grid" aria-label="Memory bytes" tabindex="0"><div id="rows"></div></div>
<div id="menu" role="menu" hidden><button role="menuitem" data-action="copy">Copy</button><button role="menuitem" data-action="source">Find in Source</button></div>
<script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}