import * as vscode from 'vscode';
import { Logger } from './platform/logging/logger';
import { PathService } from './platform/files/path-service';
import { WorkspaceService } from './platform/files/workspace-service';
import { ProcessRunner } from './platform/process/process-runner';
import { DisposableStore, toDisposable } from './platform/disposable/lifecycle';
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
import { RunProjectCommand } from './commands/run-project-command';
import { CreateProjectCommand } from './commands/create-project-command';
import { FddPersistence } from './emulator/persistence/fdd-persistence';

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
        which: () => undefined,
    });
    const launcher = new V6emulLauncher(processRunner, logger);
    const ipcClient = new IpcClient(logger);
    const lifecycle = new EmulatorLifecycle(locator, launcher, ipcClient, logger, pathService);
    const emulatorPanel = store.add(new EmulatorPanel(
        context.extensionUri, lifecycle, ipcClient, logger,
    ));
    const fddPersistence = new FddPersistence(ipcClient, logger);

    // Persist FDD images before emulator stops
    const onBeforeStop = async () => {
        const project = activeProjectService.getActiveProject();
        if (project) {
            await fddPersistence.persistIfNeeded(
                project.run.fddReadOnly ?? false,
                project.run.executable,
            );
        }
    };
    lifecycle.on('stateChange', (state: string) => {
        // Trigger FDD persistence when transitioning away from running
        if (state === 'stopped') {
            // Already stopped — persistence should happen before stop()
        }
    });

    // Commands
    const runProjectCmd = new RunProjectCommand(
        activeProjectService, lifecycle, ipcClient, emulatorPanel, logger,
    );
    const createProjectCmd = new CreateProjectCommand(
        context.extensionUri.fsPath, logger,
    );

    logger.info('Vector-06c extension activating.');

    // Language support
    const v6asmSelector: vscode.DocumentSelector = { language: 'v6asm' };
    store.add(
        vscode.languages.registerDocumentLinkProvider(v6asmSelector, new IncludeLinkProvider())
    );

    store.add(
        vscode.commands.registerCommand(CMD_CREATE_PROJECT, () => createProjectCmd.execute())
    );

    store.add(
        vscode.commands.registerCommand(CMD_RUN_PROJECT, () => runProjectCmd.execute())
    );

    // Override lifecycle.stop to persist FDD before stopping
    const originalStop = lifecycle.stop.bind(lifecycle);
    lifecycle.stop = async () => {
        await onBeforeStop();
        return originalStop();
    };

    context.subscriptions.push(store);

    logger.info('Vector-06c extension activated.');
}

export function deactivate(): void {
    // Cleanup handled by DisposableStore via context.subscriptions.
}
