import * as vscode from 'vscode';
import { V6Project } from '../model/v6-project';
import { ProjectDiscovery } from '../discovery/project-discovery';
import { ProjectRepository } from '../persistence/project-repository';
import { Logger } from '../../platform/logging/logger';
import { WorkspaceService } from '../../platform/files/workspace-service';

export class ActiveProjectService {
    private activeProject: V6Project | undefined;

    constructor(
        private readonly discovery: ProjectDiscovery,
        private readonly repository: ProjectRepository,
        private readonly workspaceService: WorkspaceService,
        private readonly logger: Logger,
    ) {}

    getActiveProject(): V6Project | undefined {
        return this.activeProject;
    }

    async resolve(): Promise<V6Project | undefined> {
        const roots = this.workspaceService.getRootUris();
        const projectUris = await this.discovery.findProjects(roots);

        if (projectUris.length === 0) {
            this.logger.info('No *.project.json files found in workspace.');
            this.activeProject = undefined;
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

            if (!picked) {
                return this.activeProject;
            }

            selectedUri = picked.uri;
            this.logger.info(`User selected project: ${selectedUri.fsPath}`);
        }

        this.activeProject = await this.repository.load(selectedUri);
        return this.activeProject;
    }
}
