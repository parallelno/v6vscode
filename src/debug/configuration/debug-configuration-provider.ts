import * as vscode from 'vscode';
import * as path from 'path';
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
                program: project.run.executable,
                debugArtifact: '',
                bootRom: project.run.bootRom ?? '',
                loadAddress: project.run.loadAddr ?? '',
                speed: project.run.speed ?? '100%',
                stopOnEntry: false,
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
        // If config is empty (F5 with no launch.json), inject defaults from project.
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
                program: project.run.executable,
                bootRom: project.run.bootRom ?? '',
                loadAddress: project.run.loadAddr ?? '',
                speed: project.run.speed ?? '100%',
                stopOnEntry: false,
            });
        }

        // Validate the program path for launch configs.
        if (config.request === 'launch') {
            const program = config.program as string | undefined;
            if (!program) {
                vscode.window.showErrorMessage('V6 Debug: "program" is required in launch configuration.');
                return undefined;
            }
            const resolved = this.resolvePath(program, folder);
            if (!fs.existsSync(resolved)) {
                const choice = await vscode.window.showErrorMessage(
                    `V6 Debug: program not found: ${resolved}. Build the project first (run \`make\`).`,
                    'Open Terminal',
                );
                if (choice === 'Open Terminal') {
                    vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal');
                }
                return undefined;
            }
            config.program = resolved;
        }

        this.logger.debug(`v6 debug config resolved: ${JSON.stringify(config)}`);
        return config;
    }

    /** Get active project, resolving from disk if not yet cached. */
    private async getOrResolveProject() {
        return this.activeProjectService.getActiveProject()
            ?? await this.activeProjectService.resolve();
    }

    private resolvePath(p: string, folder: vscode.WorkspaceFolder | undefined): string {
        if (path.isAbsolute(p)) {
            return p;
        }
        const base = folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        return path.resolve(base, p);
    }

    private defaultLaunchConfig(): vscode.DebugConfiguration {
        return {
            type: V6_DEBUG_TYPE,
            request: 'launch',
            name: 'Launch V6 ROM',
            program: 'out/${workspaceFolderBasename}.rom',
            debugArtifact: '',
            stopOnEntry: false,
        };
    }
}
