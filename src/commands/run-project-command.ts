import * as fs from 'fs';
import * as vscode from 'vscode';
import { V6Project } from '../project/model/v6-project';
import { ActiveProjectService } from '../project/active/active-project-service';
import { EmulatorLifecycle } from '../emulator/lifecycle/emulator-lifecycle';
import { EmulatorPanel } from '../emulator/panel/emulator-panel';
import { IpcClient } from '../emulator/client/ipc-client';
import { Logger } from '../platform/logging/logger';
import { V6Error } from '../platform/errors/v6-error';
import { ErrorCode } from '../platform/errors/error-codes';
import { showV6Error } from '../platform/errors/error-ux';

export class RunProjectCommand {
    constructor(
        private readonly activeProjectService: ActiveProjectService,
        private readonly lifecycle: EmulatorLifecycle,
        _client: IpcClient,
        private readonly panel: EmulatorPanel,
        private readonly logger: Logger,
    ) {}

    async execute(): Promise<void> {
        const project = await this.activeProjectService.resolve();
        if (!project) {
            vscode.window.showWarningMessage(
                'V6: No project found. Create one with "V6: Create Project".',
            );
            return;
        }

        try {
            this.validateExecutable(project);

            if (this.lifecycle.running) {
                // Emulator already running — reload executable without restart
                await this.lifecycle.reloadRunProgram(project);
            } else {
                await this.lifecycle.start(project);
            }
            await this.panel.applyProjectSettings(project);
            this.panel.reveal();
        } catch (err) {
            if (err instanceof V6Error) {
                await showV6Error(err, this.logger);
            } else {
                const msg = err instanceof Error ? err.message : String(err);
                this.logger.error(`run-project: ${msg}`);
                vscode.window.showErrorMessage(`V6: Failed to run project — ${msg}`);
            }
        }
    }

    private validateExecutable(project: V6Project): void {
        if (!fs.existsSync(project.run.executable)) {
            throw new V6Error(
                ErrorCode.EXECUTABLE_NOT_FOUND,
                `Executable not found: ${project.run.executable}. Build the project first.`,
            );
        }
    }

}
