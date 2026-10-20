import * as vscode from 'vscode';
import { V6Project } from '../model/v6-project';
import { ProjectDiscovery } from '../discovery/project-discovery';
import { ProjectRepository } from '../persistence/project-repository';
import { Logger } from '../../platform/logging/logger';
import { WorkspaceService } from '../../platform/files/workspace-service';

export class ActiveProjectService {
    private activeProject: V6Project | undefined;
    private readonly projectChanged = new vscode.EventEmitter<V6Project | undefined>();
    readonly onDidChange = this.projectChanged.event;
    private resolveGeneration = 0;
    private publishedKey = '';
    private readonly savedListener: vscode.Disposable | undefined;

    constructor(
        private readonly discovery: ProjectDiscovery,
        private readonly repository: ProjectRepository,
        private readonly workspaceService: WorkspaceService,
        private readonly logger: Logger,
    ) {
        this.savedListener = repository.onDidSave?.(project => {
            if (project.uri.fsPath === this.activeProject?.uri.fsPath) { this.resolveGeneration++; this.publish(project); }
        });
    }

    getActiveProject(): V6Project | undefined {
        return this.activeProject;
    }

    async resolve(): Promise<V6Project | undefined> {
        const generation = ++this.resolveGeneration;
        const roots = this.workspaceService.getRootUris();
        const projectUris = await this.discovery.findProjects(roots);
        if (generation !== this.resolveGeneration) { return this.activeProject; }

        if (projectUris.length === 0) {
            this.logger.info('No *.project.json files found in workspace.');
            this.publish(undefined);
            return undefined;
        }

        let selectedUri: vscode.Uri;

        if (projectUris.length === 1) {
            selectedUri = projectUris[0];
            this.logger.info(`Auto-selected project: ${selectedUri.fsPath}`);
        } else {
            const items = projectUris.map(uri => ({
                label: uri.fsPath.split(/[\\/]/).pop()!,
                description: uri.fsPath,
                uri,
            }));

            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select a project',
            });
            if (generation !== this.resolveGeneration) { return this.activeProject; }

            if (!picked) {
                return this.activeProject;
            }

            selectedUri = picked.uri;
            this.logger.info(`User selected project: ${selectedUri.fsPath}`);
        }

        const project = await this.repository.load(selectedUri);
        if (generation !== this.resolveGeneration) { return this.activeProject; }
        this.publish(project);
        return this.activeProject;
    }

    dispose(): void { this.resolveGeneration++; this.savedListener?.dispose(); this.projectChanged.dispose(); }

    private publish(project: V6Project | undefined): void {
        const key = project ? JSON.stringify([project.uri.fsPath, project.run]) : '';
        this.activeProject = project;
        if (key !== this.publishedKey) {
            this.publishedKey = key;
            this.projectChanged.fire(project);
        }
    }
}
