import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { FddPersistence } from '../../emulator/persistence/fdd-persistence';
import { Logger } from '../../platform/logging/logger';
import {
    formatMainStatistics,
    formatRamDisk,
    paletteTooltip,
    parseHardwareByte,
    vectorColorRgb24,
} from '../hardware-statistics/hardware-statistics-format';
import { HardwareStatisticsService } from '../hardware-statistics/hardware-statistics-service';
import {
    HardwareStatisticsHostMessage,
    HardwareStatisticsViewModel,
    HardwareStatisticsWebviewMessage,
} from './hardware-statistics-messages';

export const HARDWARE_STATISTICS_VIEW_ID = 'v6.hardwareStatistics';
export const CMD_REFRESH_HARDWARE_STATISTICS = 'v6.refreshHardwareStatistics';

export class HardwareStatisticsProvider implements vscode.WebviewViewProvider, vscode.Disposable {
    private view: vscode.WebviewView | undefined;
    private readonly stateListener: () => void;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly lifecycle: EmulatorLifecycle,
        private readonly service: HardwareStatisticsService,
        private readonly fddPersistence: FddPersistence,
        private readonly logger: Logger,
    ) {
        this.stateListener = () => this.postCurrentState();
        this.service.on('change', this.stateListener);
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        const assetsUri = vscode.Uri.joinPath(this.extensionUri, 'src', 'debug', 'views', 'assets');
        view.webview.options = { enableScripts: true, localResourceRoots: [assetsUri] };
        view.webview.html = this.html(view.webview, assetsUri);
        view.webview.onDidReceiveMessage((message: HardwareStatisticsWebviewMessage) => void this.handleMessage(message));
        view.onDidChangeVisibility(() => {
            this.service.setVisible(view.visible);
            if (view.visible) this.postCurrentState();
        });
        view.onDidDispose(() => {
            this.service.setVisible(false);
            this.view = undefined;
        });
        this.service.setVisible(view.visible);
    }

    async refresh(): Promise<void> {
        try {
            await this.service.refresh();
        } catch (error) {
            this.report(error);
        }
    }

    dispose(): void {
        this.service.removeListener('change', this.stateListener);
        this.service.setVisible(false);
    }

    private async handleMessage(message: HardwareStatisticsWebviewMessage): Promise<void> {
        if (!message || typeof message.type !== 'string') { return; }
        try {
            if (message.type === 'ready') {
                this.postCurrentState();
                await this.refresh();
                return;
            }
            if (!this.current(message)) { return; }
            switch (message.type) {
                case 'refresh': await this.refresh(); break;
                case 'copyPalette': await this.copyPalette(message.index); break;
                case 'pastePalette': await this.pastePalette(message.index); break;
                case 'editPalette': await this.editPalette(message.index, message.value); break;
                case 'mountDrive': await this.mountDrive(message.driveIdx); break;
                case 'dismountDrive': await this.dismountDrive(message.driveIdx); break;
            }
        } catch (error) {
            this.report(error);
        }
    }

    private async copyPalette(index: number): Promise<void> {
        const color = this.paletteColor(index);
        await vscode.env.clipboard.writeText(`0x${color.toString(16).toUpperCase().padStart(2, '0')}`);
    }

    private async pastePalette(index: number): Promise<void> {
        this.paletteColor(index);
        await this.updatePalette(index, await vscode.env.clipboard.readText());
    }

    private async editPalette(index: number, value: string): Promise<void> {
        if (typeof value !== 'string') { throw new Error('Palette color must be text'); }
        this.paletteColor(index);
        await this.updatePalette(index, value);
    }

    private async updatePalette(index: number, value: string): Promise<void> {
        const color = parseHardwareByte(value);
        await this.service.setPaletteEntry(index, color);
        this.post({ type: 'operation', ok: true, message: `Palette ${index} updated` });
    }

    private async mountDrive(driveIdx: number): Promise<void> {
        const drive = this.drive(driveIdx);
        const selection = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'Floppy disk images': ['fdd'], 'All files': ['*'] },
            title: `Mount Drive ${String.fromCharCode(65 + driveIdx)}`,
        });
        if (!selection?.[0]) { return; }
        if (!await this.resolveDirtyDrive(driveIdx, drive.updated, drive.path)) { return; }
        const bytes = await vscode.workspace.fs.readFile(selection[0]);
        await this.service.mountDrive(driveIdx, Array.from(bytes), selection[0].fsPath);
        this.post({ type: 'operation', ok: true, message: `Drive ${String.fromCharCode(65 + driveIdx)} mounted` });
    }

    private async dismountDrive(driveIdx: number): Promise<void> {
        const drive = this.drive(driveIdx);
        if (!drive.mounted) { return; }
        if (!await this.resolveDirtyDrive(driveIdx, drive.updated, drive.path)) { return; }
        await this.service.dismountDrive(driveIdx);
        this.post({ type: 'operation', ok: true, message: `Drive ${String.fromCharCode(65 + driveIdx)} dismounted` });
    }

    private async resolveDirtyDrive(driveIdx: number, updated: boolean, path: string): Promise<boolean> {
        if (!updated) { return true; }
        const answer = await vscode.window.showWarningMessage(
            `Drive ${String.fromCharCode(65 + driveIdx)} has unsaved changes.`,
            { modal: true }, 'Save and Continue', 'Discard and Continue',
        );
        if (answer === 'Save and Continue') {
            if (!path) { throw new Error('The mounted FDD has no path for saving'); }
            await this.fddPersistence.persistDriveIfNeeded(driveIdx, path);
            return true;
        }
        return answer === 'Discard and Continue';
    }

    private postCurrentState(): void {
        if (!this.view?.visible) { return; }
        const state = this.service.state;
        if (!this.lifecycle.connected) {
            this.post({ type: 'reset', generation: state.generation });
            this.post({ type: 'state', state: 'noSession', message: 'No active emulator session', canMutate: false });
            return;
        }
        if (!this.service.available) {
            this.post({
                type: 'state', state: 'unsupported', canMutate: false,
                message: `v6emul ${this.lifecycle.serverInfo?.emulatorVersion ?? 'unknown'} does not support hardware statistics schema 1`,
            });
            return;
        }
        if (state.snapshot) this.post({ type: 'snapshot', model: this.viewModel() });
        const running = this.lifecycle.running;
        this.post({
            type: 'state',
            state: running ? 'running' : state.synchronizing ? 'loading' : 'ready',
            message: running ? 'Running; values refresh when paused' : state.synchronizing ? 'Synchronizing...' : 'Paused',
            canMutate: !running && !state.synchronizing,
        });
    }

    private viewModel(): HardwareStatisticsViewModel {
        const state = this.service.state;
        const snapshot = state.snapshot;
        if (!snapshot) { throw new Error('Hardware statistics snapshot is unavailable'); }
        const driveNames = ['Drive A', 'Drive B', 'Drive C', 'Drive D'];
        return {
            generation: state.generation,
            rows: formatMainStatistics(snapshot),
            palette: snapshot.palette.map((hwColor, index) => ({
                index,
                hwColor,
                rgb: `#${vectorColorRgb24(hwColor).toString(16).toUpperCase().padStart(6, '0')}`,
                tooltip: paletteTooltip(index, hwColor),
            })),
            ramDisk: formatRamDisk(snapshot.ramDisk.index, snapshot.ramDisk.mapping),
            selectedDrive: String.fromCharCode(65 + snapshot.fdc.selectedDrive),
            drives: snapshot.fdc.drives.map((drive, index) => ({ index, label: driveNames[index], ...drive })),
        };
    }

    private paletteColor(index: number): number {
        if (!Number.isInteger(index) || index < 0 || index > 15) { throw new Error('Invalid palette index'); }
        const color = this.service.state.snapshot?.palette[index];
        if (color === undefined) { throw new Error('Palette snapshot is unavailable'); }
        return color;
    }

    private drive(index: number) {
        if (!Number.isInteger(index) || index < 0 || index > 3) { throw new Error('Invalid drive index'); }
        const drive = this.service.state.snapshot?.fdc.drives[index];
        if (!drive) { throw new Error('FDD snapshot is unavailable'); }
        return drive;
    }

    private current(message: { generation: number }): boolean {
        return Number.isInteger(message.generation) && message.generation === this.service.sessionGeneration;
    }

    private report(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`hardware-statistics: ${message}`);
        this.post({ type: 'operation', ok: false, message });
        void vscode.window.showErrorMessage(`Hardware Statistics: ${message}`);
    }

    private post(message: HardwareStatisticsHostMessage): void { void this.view?.webview.postMessage(message); }

    private html(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'hardware-statistics.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'hardware-statistics.js'));
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${cssUri}"><title>V6 Hardware Statistics</title></head>
<body><div id="status" role="status">No active emulator session</div><main id="content" hidden>
<dl id="main-stats" class="properties"></dl><hr><section><h2>Palette</h2><div id="palette" class="palette" role="grid" aria-label="Hardware palette"></div></section>
<hr><section><h2>Peripherals</h2><h3>RAM Disk</h3><dl id="ram-disk" class="properties"></dl></section>
<hr><section><h2>FDC</h2><dl id="fdc" class="properties"></dl></section></main>
<div id="tooltip" role="tooltip" hidden></div><div id="menu" role="menu" hidden><button role="menuitem" data-action="copy">Copy</button><button role="menuitem" data-action="edit">Edit</button><button role="menuitem" data-action="paste">Paste</button><button role="menuitem" data-action="mount">Mount</button><button role="menuitem" data-action="dismount">Dismount</button></div><div id="live" class="sr-only" aria-live="polite"></div>
<script nonce="${nonce}" src="${jsUri}"></script></body></html>`;
    }
}
