import * as vscode from 'vscode';
import { V6Project } from '../../project/model/v6-project';
import { IpcClient } from '../client/ipc-client';
import { EmulatorLifecycle } from '../lifecycle/emulator-lifecycle';
import { IpcCommand, SPEED_VALUES } from '../protocol/ipc-commands';
import { DisplayMode } from './emulator-viewmodel';

export interface EmulatorSettingsState {
    speed: string;
    viewMode: DisplayMode;
    hasProject: boolean;
}

export class EmulatorSettingsController implements vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<EmulatorSettingsState>();
    private state: EmulatorSettingsState = {
        speed: '100%',
        viewMode: 'borderless',
        hasProject: false,
    };

    readonly onDidChange = this.changeEmitter.event;

    constructor(
        private readonly lifecycle: EmulatorLifecycle,
        private readonly client: IpcClient,
        private readonly loadProject: () => Promise<V6Project | undefined>,
        private readonly saveProject: (project: V6Project) => Promise<void>,
    ) {}

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

    dispose(): void {
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
        return { speed, viewMode, hasProject: true };
    }

    private update(state: EmulatorSettingsState): void {
        this.state = state;
        this.changeEmitter.fire(this.current);
    }
}

function isDisplayMode(value: string): value is DisplayMode {
    return value === 'full' || value === 'border' || value === 'borderless';
}