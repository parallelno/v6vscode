import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { Logger } from '../../platform/logging/logger';
import { EmulatorSettingsController, EmulatorSettingsState } from './emulator-settings-controller';

type SettingsMessage =
    | { type: 'ready' }
    | { type: 'setSpeed'; value: string }
    | { type: 'setViewMode'; value: string }
    | { type: 'setScriptOverlaysHidden'; value: boolean }
    | { type: 'setScriptOverlayFontSize'; value: number };

export class EmulatorSettingsPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private readonly settingsSubscription: vscode.Disposable;

    constructor(
        private readonly settings: EmulatorSettingsController,
        private readonly logger: Logger,
        private readonly onOpenStateChanged: (open: boolean) => void,
    ) {
        this.settingsSubscription = settings.onDidChange(state => this.postState(state));
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
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'v6emulSettings', 'Settings', vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true },
        );
        this.panel = panel;
        panel.webview.html = this.html(panel.webview);
        panel.webview.onDidReceiveMessage((message: SettingsMessage) => void this.handleMessage(message));
        panel.onDidChangeViewState(event => {
            if (event.webviewPanel.active) { void this.refresh(); }
        });
        panel.onDidDispose(() => {
            this.panel = undefined;
            this.onOpenStateChanged(false);
        });
        this.onOpenStateChanged(true);
    }

    dispose(): void {
        this.settingsSubscription.dispose();
        this.panel?.dispose();
    }

    private async handleMessage(message: SettingsMessage): Promise<void> {
        try {
            if (message.type === 'ready') {
                await this.refresh();
            } else if (message.type === 'setSpeed') {
                await this.settings.setSpeed(message.value);
            } else if (message.type === 'setViewMode') {
                await this.settings.setViewMode(message.value);
            } else if (message.type === 'setScriptOverlaysHidden') {
                await this.settings.setScriptOverlaysHidden(message.value);
            } else if (message.type === 'setScriptOverlayFontSize') {
                await this.settings.setScriptOverlayFontSize(message.value);
            }
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.logger.error(`emulator-settings: ${text}`);
            void this.panel?.webview.postMessage({ type: 'error', message: text });
            this.postState(this.settings.current);
        }
    }

    private async refresh(): Promise<void> {
        try {
            this.postState(await this.settings.refresh());
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.logger.error(`emulator-settings: ${text}`);
            void this.panel?.webview.postMessage({ type: 'error', message: text });
        }
    }

    private postState(state: EmulatorSettingsState): void {
        void this.panel?.webview.postMessage({ type: 'state', ...state });
    }

    private html(webview: vscode.Webview): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Settings</title>
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:20px;max-width:520px}h1{font-size:18px;font-weight:600;margin:0 0 20px}.setting{display:grid;grid-template-columns:140px 1fr;align-items:center;margin:12px 0}select,input{font:inherit;color:var(--vscode-dropdown-foreground);background:var(--vscode-dropdown-background);border:1px solid var(--vscode-dropdown-border);padding:5px 8px}input[type=checkbox]{justify-self:start}input[type=number]{width:90px}#status{margin-top:16px;color:var(--vscode-descriptionForeground)}.error{color:var(--vscode-errorForeground)}</style></head>
<body><h1>Emulator Settings</h1><label class="setting"><span>Speed</span><select id="speed"><option>1%</option><option>20%</option><option>50%</option><option>100%</option><option>200%</option><option value="max">Max</option></select></label>
<label class="setting"><span>Display</span><select id="display"><option value="borderless">Borderless</option><option value="border">Border</option><option value="full">Full</option></select></label><label class="setting"><span>Hide All Overlays</span><input id="hide-overlays" type="checkbox"></label><label class="setting"><span>Font Size</span><input id="overlay-font-size" type="number" min="6" max="48" step="1"></label><div id="status" role="status"></div>
<script nonce="${nonce}">const vscode=acquireVsCodeApi();const speed=document.getElementById('speed');const display=document.getElementById('display');const hideOverlays=document.getElementById('hide-overlays');const overlayFontSize=document.getElementById('overlay-font-size');const status=document.getElementById('status');speed.addEventListener('change',()=>vscode.postMessage({type:'setSpeed',value:speed.value}));display.addEventListener('change',()=>vscode.postMessage({type:'setViewMode',value:display.value}));hideOverlays.addEventListener('change',()=>vscode.postMessage({type:'setScriptOverlaysHidden',value:hideOverlays.checked}));overlayFontSize.addEventListener('change',()=>vscode.postMessage({type:'setScriptOverlayFontSize',value:Number(overlayFontSize.value)}));window.addEventListener('message',event=>{const message=event.data;if(message.type==='state'){speed.value=message.speed;display.value=message.viewMode;hideOverlays.checked=message.scriptOverlaysHidden;overlayFontSize.value=String(message.scriptOverlayFontSize);speed.disabled=display.disabled=!message.hasProject;status.className='';status.textContent=message.hasProject?'':'No active V6 project';}else if(message.type==='error'){status.className='error';status.textContent=message.message;}});vscode.postMessage({type:'ready'});</script></body></html>`;
    }
}