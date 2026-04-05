import * as vscode from 'vscode';
import { Logger } from './platform/logging/logger';
import { PathService } from './platform/files/path-service';
import { WorkspaceService } from './platform/files/workspace-service';
import { ProcessRunner } from './platform/process/process-runner';
import { DisposableStore } from './platform/disposable/lifecycle';
import { CMD_CREATE_PROJECT, CMD_RUN_PROJECT, OUTPUT_CHANNEL_NAME } from './config/contribution-ids';
import { ProjectDiscovery } from './project/discovery/project-discovery';
import { ProjectRepository } from './project/persistence/project-repository';
import { ActiveProjectService } from './project/active/active-project-service';

export function activate(context: vscode.ExtensionContext): void {
    const store = new DisposableStore();

    const logger = store.add(new Logger(OUTPUT_CHANNEL_NAME));
    const pathService = new PathService(context.extensionUri);
    const workspaceService = new WorkspaceService();
    const processRunner = new ProcessRunner();

    const projectDiscovery = new ProjectDiscovery();
    const projectRepository = new ProjectRepository(logger);
    const activeProjectService = new ActiveProjectService(
        projectDiscovery, projectRepository, workspaceService, logger,
    );

    logger.info('Vector-06c extension activating.');

    // Stub commands — will be replaced in later phases
    store.add(
        vscode.commands.registerCommand(CMD_CREATE_PROJECT, () => {
            vscode.window.showInformationMessage('V6: Create Project — not yet implemented.');
        })
    );

    store.add(
        vscode.commands.registerCommand(CMD_RUN_PROJECT, async () => {
            const project = await activeProjectService.resolve();
            if (project) {
                vscode.window.showInformationMessage(`V6: Active project — ${project.name}`);
            } else {
                vscode.window.showWarningMessage('V6: No project found. Create one with "V6: Create Project".');
            }
        })
    );

    context.subscriptions.push(store);

    logger.info('Vector-06c extension activated.');
}

export function deactivate(): void {
    // Cleanup handled by DisposableStore via context.subscriptions
}
