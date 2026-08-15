import * as vscode from 'vscode';
import * as fs from 'fs';
import { ActiveProjectService } from '../../project/active/active-project-service';
import { Logger } from '../../platform/logging/logger';

export const V6_DEBUG_TYPE = 'v6';

/**
 * Resolves and validates `v6` debug launch/attach configurations from `launch.json`
 * or from the active project when no configuration is provided.
 */
export class V6DebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    constructor(
        private readonly activeProjectService: ActiveProjectService,
        private readonly logger: Logger,
    ) {}

    /**
     * Called when no launch.json entry exists — generate initial configurations
     * from the active project.
     */
    async provideDebugConfigurations(
        _folder: vscode.WorkspaceFolder | undefined,
    ): Promise<vscode.DebugConfiguration[]> {
        const project = await this.getOrResolveProject();
        if (!project) {
            return [this.defaultLaunchConfig()];
        }

        return [
            {
                type: V6_DEBUG_TYPE,
                request: 'launch',
                name: `Launch ${project.name}`,
            },
        ];
    }

    /**
     * Called before a debug session starts — fill in defaults and validate paths.
     */
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
    ): Promise<vscode.DebugConfiguration | undefined> {
        // If config is empty (F5 with no launch.json), inject debugger defaults.
        if (!config.type && !config.request) {
            const project = await this.getOrResolveProject();
            if (!project) {
                vscode.window.showErrorMessage(
                    'V6: No active project found. Open a workspace containing a *.project.json file.',
                );
                return undefined;
            }
            Object.assign(config, {
                type: V6_DEBUG_TYPE,
                request: 'launch',
                name: `Launch ${project.name}`,
            });
        }

        // Launch settings come exclusively from the active project file.
        if (config.request === 'launch') {
            const project = await this.getOrResolveProject();
            if (!project) {
                vscode.window.showErrorMessage(
                    'V6: No active project found. Open a workspace containing a *.project.json file.',
                );
                return undefined;
            }
            if (!fs.existsSync(project.run.executable)) {
                const choice = await vscode.window.showErrorMessage(
                    `V6 Debug: executable not found: ${project.run.executable}. Build the project first (run \`make\`).`,
                    'Open Terminal',
                );
                if (choice === 'Open Terminal') {
                    vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
                }
                return undefined;
            }
            config.program = project.run.executable;
            config.bootRom = project.run.bootRom ?? '';
            config.loadAddress = project.run.loadAddr;
            config.speed = project.run.speed;
            delete config.stopOnEntry;

            if (project.run.debugArtifact) {
                config.debugArtifact = project.run.debugArtifact;
            } else {
                delete config.debugArtifact;
            }
        }

        this.logger.debug(`v6 debug config resolved: ${JSON.stringify(config)}`);
        return config;
    }

    /** Get active project, resolving from disk if not yet cached. */
    private async getOrResolveProject() {
        return this.activeProjectService.getActiveProject()
            ?? await this.activeProjectService.resolve();
    }

    private defaultLaunchConfig(): vscode.DebugConfiguration {
        return {
            type: V6_DEBUG_TYPE,
            request: 'launch',
            name: 'Launch V6 ROM',
        };
    }
}
