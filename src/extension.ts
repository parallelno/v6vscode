import * as fs from 'fs';
import * as vscode from 'vscode';
import { Logger } from './platform/logging/logger';
import { PathService } from './platform/files/path-service';
import { WorkspaceService } from './platform/files/workspace-service';
import { ProcessRunner } from './platform/process/process-runner';
import { DisposableStore } from './platform/disposable/lifecycle';
import {
    CMD_CREATE_PROJECT,
    CMD_RUN_PROJECT,
    CMD_TOGGLE_DISPLAY,
    CMD_TOGGLE_HEX_VIEWER,
    CMD_TOGGLE_SETTINGS,
    CMD_TOGGLE_WATCHPOINTS,
    CONTEXT_DISPLAY_OPEN,
    CONTEXT_HEX_VIEWER_OPEN,
    CONTEXT_SETTINGS_OPEN,
    CONTEXT_WATCHPOINTS_OPEN,
    OUTPUT_CHANNEL_NAME,
    SETTING_EMULATOR_PATH,
} from './config/contribution-ids';
import { ProjectDiscovery } from './project/discovery/project-discovery';
import { ProjectRepository } from './project/persistence/project-repository';
import { ActiveProjectService } from './project/active/active-project-service';
import { IncludeLinkProvider } from './language/includes/include-link-provider';
import { V6emulLocator } from './emulator/launcher/v6emul-locator';
import { V6emulLauncher } from './emulator/launcher/v6emul-launcher';
import { IpcClient } from './emulator/client/ipc-client';
import { EmulatorLifecycle } from './emulator/lifecycle/emulator-lifecycle';
import { EmulatorPanel } from './emulator/panel/emulator-panel';
import { EmulatorSettingsController } from './emulator/panel/emulator-settings-controller';
import { EmulatorSettingsPanel } from './emulator/panel/emulator-settings-panel';
import { EmulatorPanelLauncherView } from './emulator/panel/emulator-panel-launcher-view';
import { RunProjectCommand } from './commands/run-project-command';
import { CreateProjectCommand } from './commands/create-project-command';
import { FddPersistence } from './emulator/persistence/fdd-persistence';
import { V6DebugConfigurationProvider } from './debug/configuration/debug-configuration-provider';
import { registerDebugAdapter } from './debug/adapter/v6-debug-adapter-factory';
import {
    CMD_REFRESH_HARDWARE_STATISTICS,
    HARDWARE_STATISTICS_VIEW_ID,
    HardwareStatisticsView,
} from './debug/views/hardware-statistics-view';
import {
    CMD_REFRESH_HEX_VIEWER,
    HexViewerProvider,
} from './debug/views/hex-viewer-provider';
import { WatchpointService } from './debug/watchpoints/watchpoint-service';
import {
    CMD_ADD_WATCHPOINT,
    CMD_REFRESH_WATCHPOINTS,
    WatchpointsProvider,
} from './debug/views/watchpoints-provider';

export function activate(context: vscode.ExtensionContext): void {
    const store = new DisposableStore();

    const logger = store.add(new Logger(OUTPUT_CHANNEL_NAME));
    const pathService = new PathService(context.extensionUri);
    const workspaceService = new WorkspaceService();
    const processRunner = new ProcessRunner();
    const panelLauncher = store.add(new EmulatorPanelLauncherView());
    store.add(vscode.window.registerTreeDataProvider('v6emul.panels', panelLauncher));

    const projectDiscovery = new ProjectDiscovery();
    const projectRepository = new ProjectRepository(logger);
    const activeProjectService = new ActiveProjectService(
        projectDiscovery, projectRepository, workspaceService, logger,
    );

    // Emulator services
    const locator = new V6emulLocator({
        logger,
        getConfiguration: (section) => vscode.workspace.getConfiguration(section),
        getEnv: (name) => process.env[name],
        which: () => undefined,
    });
    const launcher = new V6emulLauncher(processRunner, logger);
    const ipcClient = new IpcClient(logger);
    const lifecycle = new EmulatorLifecycle(locator, launcher, ipcClient, logger, pathService);
    const loadActiveProject = async () => {
        const project = activeProjectService.getActiveProject();
        return project ? projectRepository.load(project.uri) : undefined;
    };
    const settingsController = store.add(new EmulatorSettingsController(
        lifecycle,
        ipcClient,
        loadActiveProject,
        project => projectRepository.save(project),
    ));
    const emulatorPanel = store.add(new EmulatorPanel(
        context.extensionUri,
        lifecycle,
        ipcClient,
        logger,
        settingsController,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_DISPLAY, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_DISPLAY_OPEN, open);
        },
    ));
    const settingsPanel = store.add(new EmulatorSettingsPanel(
        settingsController,
        logger,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_SETTINGS, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_SETTINGS_OPEN, open);
        },
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_DISPLAY_OPEN, false);
    void vscode.commands.executeCommand('setContext', CONTEXT_SETTINGS_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_DISPLAY, () => emulatorPanel.toggle()));
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_SETTINGS, () => settingsPanel.toggle()));
    const fddPersistence = new FddPersistence(ipcClient, logger);
    const hardwareStatistics = store.add(new HardwareStatisticsView(lifecycle, ipcClient, logger));
    store.add(vscode.window.registerTreeDataProvider(HARDWARE_STATISTICS_VIEW_ID, hardwareStatistics));
    store.add(vscode.commands.registerCommand(
        CMD_REFRESH_HARDWARE_STATISTICS,
        () => hardwareStatistics.refresh(),
    ));
    const hexViewer = store.add(new HexViewerProvider(
        context.extensionUri,
        lifecycle,
        ipcClient,
        activeProjectService,
        context.workspaceState,
        logger,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_HEX_VIEWER, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_HEX_VIEWER_OPEN, open);
        },
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_HEX_VIEWER_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_HEX_VIEWER, () => hexViewer.toggle()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_HEX_VIEWER, () => hexViewer.refresh()));
    const watchpointService = store.add(new WatchpointService(lifecycle, ipcClient));
    const watchpoints = store.add(new WatchpointsProvider(
        context.extensionUri,
        lifecycle,
        watchpointService,
        hexViewer,
        activeProjectService,
        logger,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_WATCHPOINTS, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_WATCHPOINTS_OPEN, open);
        },
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_WATCHPOINTS_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_WATCHPOINTS, () => watchpoints.toggle()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_WATCHPOINTS, () => watchpoints.refresh()));
    store.add(vscode.commands.registerCommand(CMD_ADD_WATCHPOINT, () => watchpoints.add()));

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
    const asmSelector: vscode.DocumentSelector = { language: 'asm' };
    store.add(
        vscode.languages.registerDocumentLinkProvider(asmSelector, new IncludeLinkProvider())
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

    // Validate emulator path setting when changed
    store.add(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration(SETTING_EMULATOR_PATH)) {
                const newPath = vscode.workspace.getConfiguration('v6').get<string>('emulatorPath', '');
                if (newPath && !fs.existsSync(newPath)) {
                    vscode.window.showWarningMessage(
                        `V6: Emulator path "${newPath}" does not exist. The extension will fall back to the bundled emulator or PATH.`,
                    );
                    logger.warn(`Setting v6.emulatorPath points to non-existent path: "${newPath}"`);
                }
            }
        })
    );

    context.subscriptions.push(store);

    // Debug adapter (Steps 3.5 / 3.8)
    const debugConfigProvider = new V6DebugConfigurationProvider(activeProjectService, logger);
    registerDebugAdapter(
        context,
        lifecycle,
        emulatorPanel,
        logger,
        pathService,
        (section) => vscode.workspace.getConfiguration(section),
        debugConfigProvider,
    );

    logger.info('Vector-06c extension activated.');
}

export function deactivate(): void {
    // Cleanup handled by DisposableStore via context.subscriptions.
}
