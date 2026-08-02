import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as path from 'path';
import { V6Project } from '../../project/model/v6-project';
import { EmulatorLifecycle } from '../lifecycle/emulator-lifecycle';
import { IpcClient } from '../client/ipc-client';
import { IpcCommand } from '../protocol/ipc-commands';
import { decodeFrameRaw } from '../protocol/ipc-codec';
import { DisplayMode, EmulatorViewModel, WebviewMessage } from './emulator-viewmodel';
import { Logger } from '../../platform/logging/logger';
import { DisposableStore, toDisposable } from '../../platform/disposable/lifecycle';
import { EmulatorSettingsController } from './emulator-settings-controller';

const FPS_UPDATE_INTERVAL_MS = 1000;

export class EmulatorPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | null = null;
    private panelStore: DisposableStore | null = null;
    private readonly store = new DisposableStore();
    private readonly viewModel = new EmulatorViewModel();
    private readonly extensionUri: vscode.Uri;
    private readonly lifecycle: EmulatorLifecycle;
    private readonly client: IpcClient;
    private readonly logger: Logger;
    private frameLoopActive = false;
    private frameCount = 0;
    private smoothFps = 0;
    private fpsTimer: ReturnType<typeof setInterval> | null = null;
    private readonly fpsStatusBarItem: vscode.StatusBarItem;

    constructor(
        extensionUri: vscode.Uri,
        lifecycle: EmulatorLifecycle,
        client: IpcClient,
        logger: Logger,
        private readonly settings: EmulatorSettingsController,
        private readonly onOpenStateChanged: (open: boolean) => void = () => {},
    ) {
        this.extensionUri = extensionUri;
        this.lifecycle = lifecycle;
        this.client = client;
        this.logger = logger;
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

    toggle(): void {
        if (this.panel) {
            this.panel.dispose();
        } else {
            this.reveal();
        }
    }

    isOpen(): boolean {
        return this.panel !== null;
    }

    close(): void {
        this.panel?.dispose();
    }

    async applyProjectSettings(project: V6Project): Promise<void> {
        await this.settings.applyProject(project);
        const current = this.settings.current;
        this.viewModel.setSpeed(current.speed);
        this.viewModel.setViewMode(current.viewMode);
    }

    dispose(): void {
        this.stopFrameLoop();
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
            'Display',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [assetsUri],
                retainContextWhenHidden: true,
            },
        );
        this.panelStore = new DisposableStore();
        const panelStore = this.panelStore;
        this.onOpenStateChanged(true);

        this.panel.webview.html = this.getHtml(this.panel.webview, assetsUri);
        this.viewModel.setViewMode(this.lifecycle.frameMode);

        panelStore.add(this.panel.onDidChangeViewState((event) => {
            if (event.webviewPanel.active) {
                void this.reloadProjectSettings();
            }
        }));

        // Handle messages from the webview
        panelStore.add(
            this.panel.webview.onDidReceiveMessage(
                (msg: WebviewMessage) => this.handleWebviewMessage(msg),
            ),
        );

        // Handle panel disposal
        this.panel.onDidDispose(() => {
            this.stopFrameLoop();
            panelStore.dispose();
            this.panelStore = null;
            this.panel = null;
            this.onOpenStateChanged(false);
            this.logger.info('emulator-panel: panel disposed');
        });

        // Listen for lifecycle state changes
        const onStateChange = () => {
            if (this.lifecycle.running) {
                this.viewModel.setRunning(true);
                this.startFrameLoop();
            } else if (this.lifecycle.state === 'stopped') {
                this.viewModel.setRunning(false);
                this.stopFrameLoop();
                this.postMessage(this.viewModel.makeResetMessage());
            } else {
                this.viewModel.setRunning(false);
                this.stopFrameLoop();
            }
        };
        this.lifecycle.on('stateChange', onStateChange);
        panelStore.add(toDisposable(() => this.lifecycle.removeListener('stateChange', onStateChange)));

        const onFrameModeChange = (frameMode: DisplayMode) => {
            this.viewModel.setViewMode(frameMode);
        };
        this.lifecycle.on('frameModeChange', onFrameModeChange);
        panelStore.add(toDisposable(() => this.lifecycle.removeListener('frameModeChange', onFrameModeChange)));

        const onError = (err: Error) => {
            this.postMessage(this.viewModel.makeErrorMessage(err.message));
        };
        this.lifecycle.on('error', onError);
        panelStore.add(toDisposable(() => this.lifecycle.removeListener('error', onError)));

        this.logger.debug('emulator-panel: panel created');
    }

    private async handleWebviewMessage(msg: WebviewMessage): Promise<void> {
        try {
            switch (msg.type) {
                case 'key':
                    if (this.client.connected) {
                        await this.client.send(IpcCommand.KEY_HANDLING, {
                            scancode: msg.scancode,
                            action: msg.action,
                        });
                    }
                    break;
                case 'ready':
                    if (this.lifecycle.running) {
                        this.startFrameLoop();
                    } else if (this.lifecycle.state === 'stopped') {
                        this.postMessage(this.viewModel.makeResetMessage());
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
            const rawBuf = await this.client.sendRaw(IpcCommand.GET_FRAME_RAW, undefined, 5000, 'low');
            const frame = decodeFrameRaw(rawBuf);
            if (frame.kind === 'error') {
                this.scheduleNextFrame();
                return;
            }
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

    private postMessage(msg: unknown): void {
        if (this.panel) {
            this.panel.webview.postMessage(msg);
        }
    }

    private async reloadProjectSettings(): Promise<void> {
        try {
            await this.settings.refresh();
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
            '    <title>Display</title>',
            '</head>',
            '<body>',
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
