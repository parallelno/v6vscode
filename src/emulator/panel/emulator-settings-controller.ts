import * as vscode from 'vscode';
import { V6Project } from '../../project/model/v6-project';
import { IpcClient } from '../client/ipc-client';
import { EmulatorLifecycle } from '../lifecycle/emulator-lifecycle';
import { IpcCommand, SPEED_VALUES } from '../protocol/ipc-commands';
import { DisplayMode } from './emulator-viewmodel';
import { SETTING_SCRIPT_OVERLAYS_FONT_SIZE, SETTING_SCRIPT_OVERLAYS_HIDDEN } from '../../config/contribution-ids';

const OVERLAY_FONT_SIZE_DEFAULT = 12;
const OVERLAY_FONT_SIZE_MIN = 6;
const OVERLAY_FONT_SIZE_MAX = 48;

export interface EmulatorSettingsState {
    speed: string;
    viewMode: DisplayMode;
    hasProject: boolean;
    scriptOverlaysHidden: boolean;
    scriptOverlayFontSize: number;
}

export class EmulatorSettingsController implements vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<EmulatorSettingsState>();
    private state: EmulatorSettingsState = {
        speed: '100%',
        viewMode: 'borderless',
        hasProject: false,
        ...readOverlaySettings(),
    };
    private readonly configurationListener: vscode.Disposable;

    readonly onDidChange = this.changeEmitter.event;

    constructor(
        private readonly lifecycle: EmulatorLifecycle,
        private readonly client: IpcClient,
        private readonly loadProject: () => Promise<V6Project | undefined>,
        private readonly saveProject: (project: V6Project) => Promise<void>,
    ) {
        const onDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration;
        this.configurationListener = typeof onDidChangeConfiguration === 'function'
            ? onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(SETTING_SCRIPT_OVERLAYS_HIDDEN)
                || event.affectsConfiguration(SETTING_SCRIPT_OVERLAYS_FONT_SIZE)) {
                this.update({ ...this.state, ...readOverlaySettings() });
            }
            })
            : { dispose: () => undefined };
    }

    get current(): EmulatorSettingsState {
        return { ...this.state };
    }

    async refresh(): Promise<EmulatorSettingsState> {
        const project = await this.loadProject();
        if (!project) {
            this.update({ ...this.state, hasProject: false });
            return this.current;
        }
        this.update(this.fromProject(project));
        return this.current;
    }

    async applyProject(project: V6Project): Promise<void> {
        const next = this.fromProject(project);
        if (this.client.connected) {
            await this.client.send(IpcCommand.SET_CPU_SPEED, { speed: SPEED_VALUES[next.speed] });
            await this.lifecycle.setFrameMode(next.viewMode);
        }
        this.update(next);
    }

    async setSpeed(speed: string): Promise<void> {
        if (SPEED_VALUES[speed] === undefined) {
            throw new Error(`Unsupported emulator speed: ${speed}`);
        }
        const project = await this.requireProject();
        if (this.client.connected) {
            await this.client.send(IpcCommand.SET_CPU_SPEED, { speed: SPEED_VALUES[speed] });
        }
        project.run.speed = speed;
        await this.saveProject(project);
        this.update({ ...this.state, speed, hasProject: true });
    }

    async setViewMode(viewMode: string): Promise<void> {
        if (!isDisplayMode(viewMode)) {
            throw new Error(`Unsupported display mode: ${viewMode}`);
        }
        const project = await this.requireProject();
        if (this.client.connected) {
            await this.lifecycle.setFrameMode(viewMode);
        }
        project.run.viewMode = viewMode === 'border' ? 'bordered' : viewMode;
        await this.saveProject(project);
        this.update({ ...this.state, viewMode, hasProject: true });
    }

    async setScriptOverlaysHidden(hidden: boolean): Promise<void> {
        if (typeof hidden !== 'boolean') { throw new Error('Hide All Overlays must be a boolean'); }
        await vscode.workspace.getConfiguration('v6').update(
            'scriptOverlays.hidden', hidden, vscode.ConfigurationTarget.Global,
        );
    }

    async setScriptOverlayFontSize(fontSize: number): Promise<void> {
        if (!Number.isSafeInteger(fontSize) || fontSize < OVERLAY_FONT_SIZE_MIN || fontSize > OVERLAY_FONT_SIZE_MAX) {
            throw new Error(`Font Size must be an integer in ${OVERLAY_FONT_SIZE_MIN}..${OVERLAY_FONT_SIZE_MAX}`);
        }
        await vscode.workspace.getConfiguration('v6').update(
            'scriptOverlays.fontSize', fontSize, vscode.ConfigurationTarget.Global,
        );
    }

    dispose(): void {
        this.configurationListener.dispose();
        this.changeEmitter.dispose();
    }

    private async requireProject(): Promise<V6Project> {
        const project = await this.loadProject();
        if (!project) {
            throw new Error('No active V6 project');
        }
        return project;
    }

    private fromProject(project: V6Project): EmulatorSettingsState {
        const speed = SPEED_VALUES[project.run.speed ?? '100%'] === undefined
            ? '100%'
            : project.run.speed ?? '100%';
        const viewMode = project.run.viewMode === 'full'
            ? 'full'
            : project.run.viewMode === 'bordered' || project.run.viewMode === 'border'
                ? 'border'
                : 'borderless';
        return { speed, viewMode, hasProject: true, ...readOverlaySettings() };
    }

    private update(state: EmulatorSettingsState): void {
        this.state = state;
        this.changeEmitter.fire(this.current);
    }
}

function isDisplayMode(value: string): value is DisplayMode {
    return value === 'full' || value === 'border' || value === 'borderless';
}

function readOverlaySettings(): Pick<EmulatorSettingsState, 'scriptOverlaysHidden' | 'scriptOverlayFontSize'> {
    const configuration = vscode.workspace.getConfiguration('v6');
    const hidden = configuration.get<unknown>('scriptOverlays.hidden');
    const fontSize = configuration.get<unknown>('scriptOverlays.fontSize');
    return {
        scriptOverlaysHidden: typeof hidden === 'boolean' ? hidden : false,
        scriptOverlayFontSize: Number.isSafeInteger(fontSize)
            && (fontSize as number) >= OVERLAY_FONT_SIZE_MIN
            && (fontSize as number) <= OVERLAY_FONT_SIZE_MAX
            ? fontSize as number
            : OVERLAY_FONT_SIZE_DEFAULT,
    };
}