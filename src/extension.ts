import * as vscode from 'vscode';
import { Logger } from './platform/logging/logger';
import { PathService } from './platform/files/path-service';
import { WorkspaceService } from './platform/files/workspace-service';
import { ProcessRunner } from './platform/process/process-runner';
import { DisposableStore } from './platform/disposable/lifecycle';
import { CMD_CREATE_PROJECT, CMD_RUN_PROJECT, OUTPUT_CHANNEL_NAME } from './config/contribution-ids';

export function activate(context: vscode.ExtensionContext): void {
    const store = new DisposableStore();

    const logger = store.add(new Logger(OUTPUT_CHANNEL_NAME));
    const pathService = new PathService(context.extensionUri);
    const workspaceService = new WorkspaceService();
    const processRunner = new ProcessRunner();

    logger.info('Vector-06c extension activating.');

    // Stub commands — will be replaced in later phases
    store.add(
        vscode.commands.registerCommand(CMD_CREATE_PROJECT, () => {
            vscode.window.showInformationMessage('V6: Create Project — not yet implemented.');
        })
    );

    store.add(
        vscode.commands.registerCommand(CMD_RUN_PROJECT, () => {
            vscode.window.showInformationMessage('V6: Run Project — not yet implemented.');
        })
    );

    context.subscriptions.push(store);

    logger.info('Vector-06c extension activated.');
}

export function deactivate(): void {
    // Cleanup handled by DisposableStore via context.subscriptions
}
