import * as vscode from 'vscode';
import { projectSourceRoot } from './project/model/source-context';
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
    CMD_TOGGLE_MEMORY_DISPLAY,
    CMD_TOGGLE_MEMORY_EDITS,
    CMD_TOGGLE_PERFORMANCE,
    CMD_TOGGLE_PORTS,
    CMD_TOGGLE_SCRIPTS,
    CMD_TOGGLE_SETTINGS,
    CMD_TOGGLE_SYMBOLS,
    CMD_TOGGLE_TRACE_LOG,
    CMD_TOGGLE_RECORDER,
    CMD_TOGGLE_WATCHPOINTS,
    CONTEXT_DISPLAY_OPEN,
    CONTEXT_HEX_VIEWER_OPEN,
    CONTEXT_MEMORY_EDITS_OPEN,
    CONTEXT_PERFORMANCE_OPEN,
    CONTEXT_PORTS_OPEN,
    CONTEXT_SCRIPTS_OPEN,
    CONTEXT_SETTINGS_OPEN,
    CONTEXT_SYMBOLS_OPEN,
    CONTEXT_TRACE_LOG_OPEN,
    CONTEXT_RECORDER_OPEN,
    CONTEXT_WATCHPOINTS_OPEN,
    CLIENT_OUTPUT_CHANNEL_NAME,
    SERVER_OUTPUT_CHANNEL_NAME,
} from './config/contribution-ids';
import { ProjectDiscovery } from './project/discovery/project-discovery';
import { ProjectRepository } from './project/persistence/project-repository';
import { ActiveProjectService } from './project/active/active-project-service';
import { IncludeLinkProvider } from './language/includes/include-link-provider';
import { IncludeHoverProvider } from './language/includes/include-hover-provider';
import { IncludeDefinitionProvider } from './language/includes/include-definition-provider';
import { IncludeDiagnostics } from './language/includes/include-diagnostics';
import { DirectivePathService } from './language/includes/directive-path-service';
import { createWorkspaceFileSearch } from './language/includes/workspace-file-search';
import { CMD_REVEAL_SYMBOL_SOURCE, SymbolLinkProvider } from './language/symbols/symbol-link-provider';
import { createLanguageServices } from './language/language-services';
import { V6emulLocator } from './emulator/launcher/v6emul-locator';
import { V6emulLauncher } from './emulator/launcher/v6emul-launcher';
import { IpcClient } from './emulator/client/ipc-client';
import { SessionCoordinator } from './emulator/session/session-coordinator';
import { EmulatorPanel } from './emulator/panel/emulator-panel';
import { MemoryDisplayPanel } from './debug/views/memory-display-panel';
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
import { MemoryEditService } from './debug/memory-edits/memory-edit-service';
import {
    CMD_ADD_MEMORY_EDIT,
    CMD_REFRESH_MEMORY_EDITS,
    MemoryEditsPanel,
} from './debug/views/memory-edits-panel';
import { PerformanceService } from './debug/performance/performance-service';
import {
    CMD_ADD_PERFORMANCE,
    CMD_REFRESH_PERFORMANCE,
    PerformancePanel,
} from './debug/views/performance-panel';
import { SourceLocation } from './debug/metadata/debug-index';
import { revealDebugSource } from './debug/views/debug-source-navigation';
import { TraceLogService } from './debug/trace-log/trace-log-service';
import { CMD_REFRESH_TRACE_LOG, TraceLogPanel } from './debug/views/trace-log-panel';
import { CMD_REFRESH_RECORDER, RecorderPanel } from './debug/views/recorder-panel';
import { ScriptService } from './debug/scripts/script-service';
import { prepareSymbolScript } from './debug/scripts/script-symbols';
import { artifactRepository } from './debug/metadata/artifact-repository';
import type { ScriptInput, ScriptLimits } from './emulator/protocol/debug-models';
import { ScriptOverlayService } from './debug/scripts/script-overlay-service';
import { CMD_ADD_SCRIPT, CMD_REFRESH_SCRIPTS, ScriptsPanel } from './debug/views/scripts-panel';

let shutdownExtension: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const store = new DisposableStore();

    const logger = store.add(new Logger(CLIENT_OUTPUT_CHANNEL_NAME));
    const serverOutput = store.add(vscode.window.createOutputChannel(SERVER_OUTPUT_CHANNEL_NAME));
    const pathService = new PathService(context.extensionUri);
    const workspaceService = new WorkspaceService();
    const processRunner = new ProcessRunner();
    const panelLauncher = store.add(new EmulatorPanelLauncherView());
    store.add(vscode.window.registerTreeDataProvider('v6emul.panels', panelLauncher));

    const projectDiscovery = new ProjectDiscovery();
    const projectRepository = store.add(new ProjectRepository(logger));
    const activeProjectService = store.add(new ActiveProjectService(
        projectDiscovery, projectRepository, workspaceService, logger,
    ));

    // Emulator services
    const locator = new V6emulLocator({
        logger,
        getEnv: (name) => process.env[name],
    });
    const launcher = new V6emulLauncher(processRunner, logger, serverOutput);
    const ipcClient = new IpcClient(logger);
    const prepareScript = async (input: ScriptInput, limits: ScriptLimits, projectPath?: string): Promise<ScriptInput> => {
        if (!input.useDebugSymbols) { return input; }
        if (!vscode.workspace.isTrusted) { throw new Error('Script symbol substitution requires a trusted workspace'); }
        const project = projectPath ? await projectRepository.loadLatest(vscode.Uri.file(projectPath)) : undefined;
        const artifact = project?.run.debugArtifact
            ? await artifactRepository.load(project.run.debugArtifact, project.run.executable) : undefined;
        return prepareSymbolScript(input, limits,
            vscode.Uri.joinPath(context.globalStorageUri, 'script-sources').fsPath, artifact?.index.allSymbols() ?? []);
    };
    const lifecycle = new SessionCoordinator(locator, launcher, ipcClient, logger, pathService, async (target, session, info) => {
        if (!vscode.workspace.isTrusted) { return; }
        const warnings: string[] = [];
        try {
            const project = await projectRepository.loadLatest(vscode.Uri.file(target.projectPath));
            session.assertCurrent();
            await ScriptService.restoreSetup(session, info, project.run.scripts ?? [], message => warnings.push(message),
                async (input, limits) => {
                    const prepared = await prepareScript(input, limits, target.projectPath);
                    session.assertCurrent();
                    return prepared;
                }, (script, input) => scriptService.remember(script, input));
        } catch (error) {
            warnings.push(error instanceof Error ? error.message : String(error));
        }
        session.assertCurrent();
        if (warnings.length) {
            logger.warn(`Script restore: ${warnings.join('; ')}`);
            void vscode.window.showWarningMessage(`V6: ${warnings[0]} See the v6vscode Output channel for details.`);
        }
    });
    shutdownExtension = async () => {
        try { await lifecycle.shutdown(); }
        finally { store.dispose(); }
    };
    const loadActiveProject = async () => {
        const project = activeProjectService.getActiveProject();
        return project ? projectRepository.load(project.uri) : undefined;
    };
    const settingsController = store.add(new EmulatorSettingsController(
        lifecycle,
        ipcClient,
        loadActiveProject,
        (project, patch) => projectRepository.updateRun(project.uri, patch),
    ));
    const scriptService = store.add(new ScriptService(lifecycle, ipcClient,
        (projectPath, scripts) => projectRepository.updateRun(vscode.Uri.file(projectPath), { scripts }),
        (input, limits) => prepareScript(input, limits, lifecycle.sessionProject?.projectPath),
    ));
    const scriptOverlays = store.add(new ScriptOverlayService(lifecycle, ipcClient, scriptService));
    const emulatorPanel = store.add(new EmulatorPanel(
        context.extensionUri,
        lifecycle,
        ipcClient,
        logger,
        settingsController,
        scriptOverlays,
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
    const createSymbols = () => store.add(new DebugSymbolService().followProject(activeProjectService));
    const debugSymbols = createSymbols();
    const languageServices = store.add(await createLanguageServices(
        context.extensionUri.fsPath,
        createSymbols(),
    ));
    const memoryEdits = store.add(new MemoryEditService(lifecycle, ipcClient));
    const hexViewer = store.add(new HexViewerProvider(
        context.extensionUri,
        lifecycle,
        ipcClient,
        memoryEdits,
        activeProjectService,
        context.workspaceState,
        logger,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_HEX_VIEWER, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_HEX_VIEWER_OPEN, open);
        },
        createSymbols(),
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_HEX_VIEWER_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_HEX_VIEWER, () => hexViewer.toggle()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_HEX_VIEWER, () => hexViewer.refresh()));
    const memoryDisplay = store.add(new MemoryDisplayPanel(context.extensionUri, lifecycle, hexViewer,
        open => panelLauncher.setOpen(CMD_TOGGLE_MEMORY_DISPLAY, open)));
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_MEMORY_DISPLAY, () => memoryDisplay.toggle()));
    const memoryEditsPanel = store.add(new MemoryEditsPanel(
        context.extensionUri,
        lifecycle,
        memoryEdits,
        hexViewer,
        context.workspaceState,
        logger,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_MEMORY_EDITS, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_MEMORY_EDITS_OPEN, open);
        },
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_MEMORY_EDITS_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_MEMORY_EDITS, () => memoryEditsPanel.toggle()));
    store.add(vscode.commands.registerCommand(CMD_ADD_MEMORY_EDIT, () => memoryEditsPanel.add()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_MEMORY_EDITS, () => memoryEditsPanel.refresh()));
    const performanceService = store.add(new PerformanceService(lifecycle, ipcClient));
    const performancePanel = store.add(new PerformancePanel(
        context.extensionUri,
        lifecycle,
        performanceService,
        createSymbols(),
        activeProjectService,
        context.workspaceState,
        logger,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_PERFORMANCE, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_PERFORMANCE_OPEN, open);
        },
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_PERFORMANCE_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_PERFORMANCE, () => performancePanel.toggle()));
    store.add(vscode.commands.registerCommand(CMD_ADD_PERFORMANCE, () => performancePanel.add()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_PERFORMANCE, () => performancePanel.refresh()));
    const traceLogService = store.add(new TraceLogService(lifecycle, ipcClient));
    const traceLog = store.add(new TraceLogPanel(
        context.extensionUri,
        lifecycle,
        traceLogService,
        createSymbols(),
        languageServices.presentation,
        languageServices.symbolLinks,
        activeProjectService,
        context.workspaceState,
        logger,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_TRACE_LOG, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_TRACE_LOG_OPEN, open);
        },
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_TRACE_LOG_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_TRACE_LOG, () => traceLog.toggle()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_TRACE_LOG, () => traceLog.refresh()));
    const scripts = store.add(new ScriptsPanel(
        context.extensionUri,
        lifecycle,
        scriptService,
        context.workspaceState,
        logger,
        open => {
            panelLauncher.setOpen(CMD_TOGGLE_SCRIPTS, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_SCRIPTS_OPEN, open);
        },
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_SCRIPTS_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_SCRIPTS, () => scripts.toggle()));
    store.add(vscode.commands.registerCommand(CMD_ADD_SCRIPT, () => scripts.add()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_SCRIPTS, () => scripts.refresh()));
    const symbols = store.add(new SymbolsPanel(
        context.extensionUri,
        lifecycle,
        activeProjectService,
        context.workspaceState,
        createSymbols(),
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
        createSymbols(),
    ));
    void vscode.commands.executeCommand('setContext', CONTEXT_WATCHPOINTS_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_WATCHPOINTS, () => watchpoints.toggle()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_WATCHPOINTS, () => watchpoints.refresh()));
    store.add(vscode.commands.registerCommand(CMD_ADD_WATCHPOINT, () => watchpoints.add()));

    store.add(lifecycle.registerStopParticipant(context => fddPersistence.persistOnStop(context)));

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
    const directivePaths = new DirectivePathService({
        findFilesByBaseName: createWorkspaceFileSearch(),
    });
    store.add(
        vscode.languages.registerDocumentLinkProvider(
            asmSelector,
            new IncludeLinkProvider(directivePaths, workspaceService),
        )
    );
    store.add(
        vscode.languages.registerHoverProvider(
            asmSelector,
            new IncludeHoverProvider(directivePaths, workspaceService),
        ),
    );
    store.add(
        vscode.languages.registerDefinitionProvider(
            asmSelector,
            new IncludeDefinitionProvider(directivePaths, workspaceService),
        ),
    );
    store.add(new IncludeDiagnostics(directivePaths, workspaceService));
    const symbolLinkProvider = new SymbolLinkProvider(
        activeProjectService,
        debugSymbols,
        languageServices.symbolLinks,
    );
    store.add(
        vscode.languages.registerHoverProvider(
            asmSelector,
            symbolLinkProvider,
        ),
    );
    store.add(
        vscode.languages.registerDefinitionProvider(
            asmSelector,
            symbolLinkProvider,
        ),
    );
    store.add(vscode.commands.registerCommand(CMD_REVEAL_SYMBOL_SOURCE, async (source: unknown) => {
        if (!isSourceLocation(source)) { return; }
        const project = activeProjectService.getActiveProject()
            ?? await activeProjectService.resolve();
        if (project) {
            await revealDebugSource(source, projectSourceRoot(project));
        }
    }));

    store.add(
        vscode.commands.registerCommand(CMD_CREATE_PROJECT, () => createProjectCmd.execute())
    );

    store.add(
        vscode.commands.registerCommand(CMD_RUN_PROJECT, () => runProjectCmd.execute())
    );

    context.subscriptions.push(store);

    // Debug adapter (Steps 3.5 / 3.8)
    const debugConfigProvider = new V6DebugConfigurationProvider(activeProjectService, logger);
    const debugAdapter = registerDebugAdapter(
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
    const recorder = store.add(new RecorderPanel(context.extensionUri, lifecycle,
        (input, current) => debugAdapter.restoreRecorder(input, current), open => {
            panelLauncher.setOpen(CMD_TOGGLE_RECORDER, open);
            void vscode.commands.executeCommand('setContext', CONTEXT_RECORDER_OPEN, open);
        }));
    void vscode.commands.executeCommand('setContext', CONTEXT_RECORDER_OPEN, false);
    store.add(vscode.commands.registerCommand(CMD_TOGGLE_RECORDER, () => recorder.toggle()));
    store.add(vscode.commands.registerCommand(CMD_REFRESH_RECORDER, () => recorder.refresh()));

    logger.info('Vector-06c extension activated.');
}

export async function deactivate(): Promise<void> {
    const shutdown = shutdownExtension;
    shutdownExtension = undefined;
    await shutdown?.();
}

function isSourceLocation(value: unknown): value is SourceLocation {
    if (!value || typeof value !== 'object') { return false; }
    const source = value as Partial<SourceLocation>;
    return typeof source.file === 'string'
        && typeof source.line === 'number' && Number.isInteger(source.line) && source.line > 0
        && typeof source.column === 'number' && Number.isInteger(source.column) && source.column >= 0
        && typeof source.isStmt === 'boolean';
}
