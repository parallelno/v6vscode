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
import { IncludeLinkProvider } from './language/includes/include-link-provider';
import { V6emulLocator } from './emulator/launcher/v6emul-locator';
import { V6emulLauncher } from './emulator/launcher/v6emul-launcher';
import { IpcClient } from './emulator/client/ipc-client';
import { EmulatorLifecycle } from './emulator/lifecycle/emulator-lifecycle';
import { EmulatorPanel } from './emulator/panel/emulator-panel';

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

    // Emulator services
    const locator = new V6emulLocator({
        pathService,
        logger,
        getConfiguration: (section) => vscode.workspace.getConfiguration(section),
        which: () => undefined, // PATH lookup deferred to Phase 6
    });
    const launcher = new V6emulLauncher(processRunner, logger);
    const ipcClient = new IpcClient(logger);
    const lifecycle = new EmulatorLifecycle(locator, launcher, ipcClient, logger, pathService);
    const emulatorPanel = store.add(new EmulatorPanel(
        context.extensionUri, lifecycle, ipcClient, logger,
    ));

    logger.info('Vector-06c extension activating.');

    // Language support
    const v6asmSelector: vscode.DocumentSelector = { language: 'v6asm' };
    store.add(
        vscode.languages.registerDocumentLinkProvider(v6asmSelector, new IncludeLinkProvider())
    );

    // Stub command — will be replaced in Phase 6
    store.add(
        vscode.commands.registerCommand(CMD_CREATE_PROJECT, () => {
            vscode.window.showInformationMessage('V6: Create Project — not yet implemented.');
        })
    );

    // Run Project command — launches emulator and opens panel
    store.add(
        vscode.commands.registerCommand(CMD_RUN_PROJECT, async () => {
            const project = await activeProjectService.resolve();
            if (!project) {
                vscode.window.showWarningMessage('V6: No project found. Create one with "V6: Create Project".');
                return;
            }
            try {
                if (!lifecycle.running) {
                    await lifecycle.start(project);
                }
                emulatorPanel.reveal();
            } catch (err) {
                vscode.window.showErrorMessage(
                    `V6: Failed to run project — ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        })
    );

    context.subscriptions.push(store);

    logger.info('Vector-06c extension activated.');
}

export function deactivate(): void {
    // Cleanup handled by DisposableStore via context.subscriptions.
}
