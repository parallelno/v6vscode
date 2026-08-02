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
    CMD_TOGGLE_PORTS,
    CMD_TOGGLE_SETTINGS,
    CMD_TOGGLE_SYMBOLS,
    CMD_TOGGLE_WATCHPOINTS,
    CONTEXT_DISPLAY_OPEN,
    CONTEXT_HEX_VIEWER_OPEN,
    CONTEXT_PORTS_OPEN,
    CONTEXT_SETTINGS_OPEN,
    CONTEXT_SYMBOLS_OPEN,
    CONTEXT_WATCHPOINTS_OPEN,
    OUTPUT_CHANNEL_NAME,
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
    HardwareStatisticsProvider,
} from './debug/views/hardware-statistics-provider';
import { HardwareStatisticsService } from './debug/hardware-statistics/hardware-statistics-service';
import {
    CMD_REFRESH_HEX_VIEWER,
    HexViewerProvider,
} from './debug/views/hex-viewer-provider';
import { PortsService } from './debug/ports/ports-service';
import { CMD_REFRESH_PORTS, PortsProvider } from './debug/views/ports-provider';
import { WatchpointService } from './debug/watchpoints/watchpoint-service';
import {
    CMD_ADD_WATCHPOINT,
    CMD_REFRESH_WATCHPOINTS,
    WatchpointsProvider,
} from './debug/views/watchpoints-provider';
import { DebugSymbolService } from './debug/metadata/debug-symbol-service';
import { SymbolsPanel } from './debug/views/symbols-panel';

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
        getEnv: (name) => process.env[name],
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
    const hardwareStatisticsService = store.add(new HardwareStatisticsService(lifecycle, ipcClient));
    const hardwareStatistics = store.add(new HardwareStatisticsProvider(
        context.extensionUri, lifecycle, hardwareStatisticsService, fddPersistence, logger,
    ));
    store.add(vscode.window.registerWebviewViewProvider(
        HARDWARE_STATISTICS_VIEW_ID,
        hardwareStatistics,
        { webviewOptions: { retainContextWhenHidden: true } },
    ));
    store.add(vscode.commands.registerCommand(
        CMD_REFRESH_HARDWARE_STATISTICS,
        () => hardwareStatistics.refresh(),
    ));
    const debugSymbols = new DebugSymbolService();
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
        debugSymbols,
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_HEX_VIEWER_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_HEX_VIEWER, () => hexViewer.toggle()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_HEX_VIEWER, () => hexViewer.refresh()));
    const symbols = store.add(new SymbolsPanel(
        context.extensionUri,
        activeProjectService,
        context.workspaceState,
        debugSymbols,
        hexViewer,
        logger,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_SYMBOLS, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_SYMBOLS_OPEN, open);
        },
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_SYMBOLS_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_SYMBOLS, () => symbols.toggle()));
    const portsService = store.add(new PortsService(lifecycle, ipcClient));
    const ports = store.add(new PortsProvider(
        context.extensionUri,
        lifecycle,
        portsService,
        logger,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_PORTS, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_PORTS_OPEN, open);
        },
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_PORTS_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_PORTS, () => ports.toggle()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_PORTS, () => ports.refresh()));
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
        watchpointService,
        watchpoints,
    );

    logger.info('Vector-06c extension activated.');
}

export function deactivate(): void {
    // Cleanup handled by DisposableStore via context.subscriptions.
}
