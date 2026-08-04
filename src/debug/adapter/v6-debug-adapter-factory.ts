import * as vscode from 'vscode';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { EmulatorPanel } from '../../emulator/panel/emulator-panel';
import { Logger } from '../../platform/logging/logger';
import { PathService } from '../../platform/files/path-service';
import { V6DebugAdapter } from './v6-debug-adapter';
import { V6_DEBUG_TYPE } from '../configuration/debug-configuration-provider';
import { WatchpointService } from '../watchpoints/watchpoint-service';
import { WatchpointsProvider } from '../views/watchpoints-provider';

export const CMD_DEBUG_RESET = 'v6.debug.reset';
export const CMD_DEBUG_RELOAD_ROM = 'v6.debug.reloadRom';

/**
 * Creates a new in-process V6DebugAdapter for each debug session.
 */
export class V6DebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    private activeAdapter: V6DebugAdapter | undefined;

    constructor(
        private readonly lifecycle: EmulatorLifecycle,
        private readonly emulatorPanel: EmulatorPanel,
        private readonly logger: Logger,
        private readonly pathService: PathService,
        private readonly getConfiguration: (s: string) => vscode.WorkspaceConfiguration,
        private readonly watchpointService: WatchpointService,
        private readonly watchpointsProvider: WatchpointsProvider,
    ) {}

    createDebugAdapterDescriptor(
        _session: vscode.DebugSession,
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        const adapter = new V6DebugAdapter(
            this.lifecycle,
            this.emulatorPanel,
            this.logger,
            this.pathService,
            this.getConfiguration,
            this.watchpointService,
            this.watchpointsProvider,
        );
        this.activeAdapter = adapter;
        return new vscode.DebugAdapterInlineImplementation(adapter);
    }

    reset(): Promise<void> {
        return this.requireActiveAdapter().reset();
    }

    reloadRom(): Promise<void> {
        return this.requireActiveAdapter().reloadRom();
    }

    private requireActiveAdapter(): V6DebugAdapter {
        if (!this.activeAdapter) { throw new Error('No active V6 debug session'); }
        return this.activeAdapter;
    }
}

/**
 * Register the debug adapter factory and configuration provider.
 * Call from extension activate().
 */
export function registerDebugAdapter(
    context: vscode.ExtensionContext,
    lifecycle: EmulatorLifecycle,
    emulatorPanel: EmulatorPanel,
    logger: Logger,
    pathService: PathService,
    getConfiguration: (s: string) => vscode.WorkspaceConfiguration,
    configProvider: vscode.DebugConfigurationProvider,
    watchpointService: WatchpointService,
    watchpointsProvider: WatchpointsProvider,
): void {
    const factory = new V6DebugAdapterFactory(
        lifecycle, emulatorPanel, logger, pathService, getConfiguration, watchpointService, watchpointsProvider,
    );

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory(V6_DEBUG_TYPE, factory),
        vscode.debug.registerDebugConfigurationProvider(V6_DEBUG_TYPE, configProvider),
        vscode.commands.registerCommand(CMD_DEBUG_RESET, () => factory.reset()),
        vscode.commands.registerCommand(CMD_DEBUG_RELOAD_ROM, () => factory.reloadRom()),
    );
}
