import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { V6Project } from '../../project/model/v6-project';
import { EmulatorLifecycle } from '../lifecycle/emulator-lifecycle';
import { IpcClient } from '../client/ipc-client';
import { GetHardwareMainStatsResponse, GetRegsResponse, IpcCommand, SPEED_VALUES } from '../protocol/ipc-commands';
import { decodeFrameRaw } from '../protocol/ipc-codec';
import { DisplayMode, EmulatorViewModel, WebviewMessage } from './emulator-viewmodel';
import { Logger } from '../../platform/logging/logger';
import { DisposableStore, toDisposable } from '../../platform/disposable/lifecycle';
import { CpuStatisticsPanel } from './cpu-statistics-panel';

const FPS_UPDATE_INTERVAL_MS = 1000;

export interface EmulatorPanelSettings {
    speed?: string;
    viewMode?: DisplayMode;
}

export class EmulatorPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | null = null;
    private readonly store = new DisposableStore();
    private readonly viewModel = new EmulatorViewModel();
    private readonly extensionUri: vscode.Uri;
    private readonly lifecycle: EmulatorLifecycle;
    private readonly client: IpcClient;
    private readonly logger: Logger;
    private readonly persistSettings: (settings: EmulatorPanelSettings) => Promise<void>;
    private readonly loadProjectSettings: () => Promise<V6Project | undefined>;
    private frameLoopActive = false;
    private frameCount = 0;
    private smoothFps = 0;
    private fpsTimer: ReturnType<typeof setInterval> | null = null;
    private readonly fpsStatusBarItem: vscode.StatusBarItem;
    private readonly cpuStatisticsPanel = new CpuStatisticsPanel();

    constructor(
        extensionUri: vscode.Uri,
        lifecycle: EmulatorLifecycle,
        client: IpcClient,
        logger: Logger,
        persistSettings: (settings: EmulatorPanelSettings) => Promise<void> = async () => {},
        loadProjectSettings: () => Promise<V6Project | undefined> = async () => undefined,
    ) {
        this.extensionUri = extensionUri;
        this.lifecycle = lifecycle;
        this.client = client;
        this.logger = logger;
        this.persistSettings = persistSettings;
        this.loadProjectSettings = loadProjectSettings;
        this.fpsStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.fpsStatusBarItem.name = 'V6 FPS';
        this.store.add(this.fpsStatusBarItem);
    }

    reveal(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        this.createPanel();
    }

    isOpen(): boolean {
        return this.panel !== null;
    }

    async applyProjectSettings(project: V6Project): Promise<void> {
        const viewMode = project.run.viewMode === 'full'
            ? 'full'
            : project.run.viewMode === 'bordered'
                ? 'border'
                : 'borderless';

        this.viewModel.setSpeed(project.run.speed ?? '100%');
        this.viewModel.setViewMode(viewMode);

        if (this.client.connected) {
            const speed = SPEED_VALUES[project.run.speed ?? '100%'];
            if (speed !== undefined) {
                await this.client.send(IpcCommand.SET_CPU_SPEED, { speed });
            }
            await this.lifecycle.setFrameMode(viewMode);
        }

        this.postMessage(this.viewModel.makeStatusMessage());
    }

    dispose(): void {
        this.stopFrameLoop();
        this.cpuStatisticsPanel.dispose();
        this.store.dispose();
        if (this.panel) {
            this.panel.dispose();
            this.panel = null;
        }
    }

    private createPanel(): void {
        const assetsPath = path.join('src', 'emulator', 'panel', 'assets');
        const assetsUri = vscode.Uri.joinPath(this.extensionUri, assetsPath);

        this.panel = vscode.window.createWebviewPanel(
            'v6emulPanel',
            'v6emul: Vector-06C',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [assetsUri],
                retainContextWhenHidden: true,
            },
        );

        this.panel.webview.html = this.getHtml(this.panel.webview, assetsUri);
        this.viewModel.setViewMode(this.lifecycle.frameMode);

        this.store.add(this.panel.onDidChangeViewState((event) => {
            if (event.webviewPanel.active) {
                void this.reloadProjectSettings();
            }
        }));

        // Handle messages from the webview
        this.store.add(
            this.panel.webview.onDidReceiveMessage(
                (msg: WebviewMessage) => this.handleWebviewMessage(msg),
            ),
        );

        // Handle panel disposal
        this.panel.onDidDispose(() => {
            this.stopFrameLoop();
            this.panel = null;
            this.logger.info('emulator-panel: panel disposed; stopping emulator');
            void this.stopEmulatorAfterPanelClose();
        });

        // Listen for lifecycle state changes
        const onStateChange = () => {
            if (this.lifecycle.running) {
                this.postMessage(this.viewModel.setRunning(true));
                this.startFrameLoop();
            } else {
                this.postMessage(this.viewModel.setRunning(false));
                this.stopFrameLoop();
                void this.showCpuStatistics();
            }
        };
        this.lifecycle.on('stateChange', onStateChange);
        this.store.add(toDisposable(() => this.lifecycle.removeListener('stateChange', onStateChange)));

        const onFrameModeChange = (frameMode: DisplayMode) => {
            this.viewModel.setViewMode(frameMode);
            this.postMessage(this.viewModel.makeStatusMessage());
        };
        this.lifecycle.on('frameModeChange', onFrameModeChange);
        this.store.add(toDisposable(() => this.lifecycle.removeListener('frameModeChange', onFrameModeChange)));

        const onError = (err: Error) => {
            this.postMessage(this.viewModel.makeErrorMessage(err.message));
        };
        this.lifecycle.on('error', onError);
        this.store.add(toDisposable(() => this.lifecycle.removeListener('error', onError)));

        this.logger.debug('emulator-panel: panel created');
    }

    private async handleWebviewMessage(msg: WebviewMessage): Promise<void> {
        try {
            switch (msg.type) {
                case 'run':
                    if (this.client.connected) {
                        await this.client.send(IpcCommand.RUN);
                        this.postMessage(this.viewModel.setRunning(true));
                        this.startFrameLoop();
                    }
                    break;
                case 'pause':
                    if (this.client.connected) {
                        await this.client.send(IpcCommand.STOP);
                        this.postMessage(this.viewModel.setRunning(false));
                        this.stopFrameLoop();
                        await this.showCpuStatistics();
                    }
                    break;
                case 'reset':
                    if (this.client.connected) {
                        await this.client.send(IpcCommand.RESET);
                    }
                    break;
                case 'setSpeed': {
                    const ipcSpeed = SPEED_VALUES[msg.value];
                    if (ipcSpeed !== undefined && this.client.connected) {
                        await this.client.send(IpcCommand.SET_CPU_SPEED, { speed: ipcSpeed });
                        this.viewModel.setSpeed(msg.value);
                        await this.persistSettings({ speed: msg.value });
                    }
                    break;
                }
                case 'setViewMode': {
                    if (this.client.connected && this.isDisplayMode(msg.value)) {
                        await this.lifecycle.setFrameMode(msg.value);
                        this.viewModel.setViewMode(msg.value);
                        await this.persistSettings({ viewMode: msg.value });
                        this.postMessage(this.viewModel.makeStatusMessage());
                    }
                    break;
                }
                case 'key':
                    if (this.client.connected) {
                        await this.client.send(IpcCommand.KEY_HANDLING, {
                            scancode: msg.scancode,
                            action: msg.action,
                        });
                    }
                    break;
                case 'ready':
                    this.postMessage(this.viewModel.makeStatusMessage());
                    if (this.lifecycle.running) {
                        this.startFrameLoop();
                    }
                    break;
            }
        } catch (err) {
            this.logger.error(`emulator-panel: message handler error: ${err instanceof Error ? err.message : String(err)}`);
            this.postMessage(this.viewModel.makeErrorMessage(
                err instanceof Error ? err.message : 'Unknown error',
            ));
        }
    }

    private startFrameLoop(): void {
        if (this.frameLoopActive) { return; }
        this.frameLoopActive = true;
        this.frameCount = 0;
        this.smoothFps = 0;
        this.scheduleNextFrame();
        this.fpsStatusBarItem.text = '$(pulse) 0 fps';
        this.fpsStatusBarItem.show();
        this.fpsTimer = setInterval(() => {
            const raw = this.frameCount;
            this.frameCount = 0;
            this.smoothFps = Math.round(this.smoothFps * 0.7 + raw * 0.3);
            this.fpsStatusBarItem.text = `$(pulse) ${this.smoothFps} fps`;
        }, FPS_UPDATE_INTERVAL_MS);
    }

    private stopFrameLoop(): void {
        this.frameLoopActive = false;
        if (this.fpsTimer) {
            clearInterval(this.fpsTimer);
            this.fpsTimer = null;
        }
        this.fpsStatusBarItem.hide();
    }

    private scheduleNextFrame(): void {
        if (!this.frameLoopActive) { return; }
        setTimeout(() => this.requestFrame(), 0);
    }

    private async requestFrame(): Promise<void> {
        if (!this.frameLoopActive || !this.client.connected || !this.panel) { return; }
        try {
            const rawBuf = await this.client.sendRaw(IpcCommand.GET_FRAME_RAW);
            const frame = decodeFrameRaw(rawBuf);
            const panelMsg = this.viewModel.processFrame(
                new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength),
                frame.width,
                frame.height,
            );
            this.postMessage(panelMsg);
            this.frameCount++;
        } catch {
            // Swallow frame errors to avoid flooding — they're transient
        }
        this.scheduleNextFrame();
    }

    private async showCpuStatistics(): Promise<void> {
        if (!this.client.connected) { return; }

        try {
            const [registersResponse, hardwareResponse] = await Promise.all([
                this.client.send<GetRegsResponse>(IpcCommand.GET_REGS),
                this.client.send<GetHardwareMainStatsResponse>(IpcCommand.GET_HW_MAIN_STATS),
            ]);
            if (!registersResponse.ok || !registersResponse.data || !hardwareResponse.ok || !hardwareResponse.data) {
                throw new Error(registersResponse.error ?? hardwareResponse.error ?? 'Failed to retrieve CPU statistics');
            }
            this.cpuStatisticsPanel.show({
                registers: registersResponse.data,
                hardware: hardwareResponse.data,
            });
        } catch (err) {
            this.logger.error(`emulator-panel: failed to retrieve CPU statistics: ${
                err instanceof Error ? err.message : String(err)
            }`);
        }
    }

    private postMessage(msg: unknown): void {
        if (this.panel) {
            this.panel.webview.postMessage(msg);
        }
    }

    private isDisplayMode(mode: string): mode is DisplayMode {
        return mode === 'full' || mode === 'border' || mode === 'borderless';
    }

    private async stopEmulatorAfterPanelClose(): Promise<void> {
        try {
            await this.lifecycle.stop();
        } catch (err) {
            this.logger.error(`emulator-panel: failed to stop emulator after panel close: ${
                err instanceof Error ? err.message : String(err)
            }`);
        }
    }

    private async reloadProjectSettings(): Promise<void> {
        try {
            const project = await this.loadProjectSettings();
            if (project) {
                await this.applyProjectSettings(project);
            }
        } catch (err) {
            this.logger.error(`emulator-panel: failed to reload project settings: ${
                err instanceof Error ? err.message : String(err)
            }`);
        }
    }

    private getHtml(webview: vscode.Webview, assetsUri: vscode.Uri): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'panel.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(assetsUri, 'panel.js'));
        const cspSource = webview.cspSource;

        // Read template and replace placeholders
        const template = [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '<head>',
            '    <meta charset="UTF-8">',
            `    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">`,
            '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
            `    <link rel="stylesheet" href="${cssUri}">`,
            '    <title>Vector-06C Emulator</title>',
            '</head>',
            '<body>',
            '    <div id="header">',
            '        <button id="btn-run-pause" title="Run / Pause">&#9654;</button>',
            '        <button id="btn-reset" title="Reset">&#8634;</button>',
            '        <label for="sel-speed">Speed:</label>',
            '        <select id="sel-speed">',
            '            <option value="1%">1%</option>',
            '            <option value="20%">20%</option>',
            '            <option value="50%">50%</option>',
            '            <option value="100%" selected>100%</option>',
            '            <option value="200%">200%</option>',
            '            <option value="max">Max</option>',
            '        </select>',
            '        <label for="sel-display">Display:</label>',
            '        <select id="sel-display">',
            '            <option value="borderless" selected>Borderless</option>',
            '            <option value="border">Border</option>',
            '            <option value="full">Full</option>',
            '        </select>',
            '    </div>',
            '    <div id="viewport">',
            '        <canvas id="screen"></canvas>',
            '    </div>',
            '    <div id="error-bar" class="hidden"></div>',
            `    <script nonce="${nonce}" src="${jsUri}"></script>`,
            '</body>',
            '</html>',
        ].join('\n');

        return template;
    }
}
