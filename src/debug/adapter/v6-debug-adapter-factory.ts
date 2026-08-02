import * as vscode from 'vscode';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { EmulatorPanel } from '../../emulator/panel/emulator-panel';
import { Logger } from '../../platform/logging/logger';
import { PathService } from '../../platform/files/path-service';
import { V6DebugAdapter } from './v6-debug-adapter';
import { V6_DEBUG_TYPE } from '../configuration/debug-configuration-provider';
import { WatchpointService } from '../watchpoints/watchpoint-service';
import { WatchpointsProvider } from '../views/watchpoints-provider';

/**
 * Creates a new in-process V6DebugAdapter for each debug session.
 */
export class V6DebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
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
        return new vscode.DebugAdapterInlineImplementation(adapter);
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
    );
}
