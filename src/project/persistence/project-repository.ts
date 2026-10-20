import * as vscode from 'vscode';
import * as path from 'path';
import { V6Project } from '../model/v6-project';
import { parse } from '../parsing/project-parser';
import { validate } from '../validation/project-validator';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';
import { Logger } from '../../platform/logging/logger';
import { normalizeRun } from '../model/normalized-run';

export class ProjectRepository implements vscode.Disposable {
    private readonly saved = new vscode.EventEmitter<V6Project>();
    readonly onDidSave = this.saved.event;
    constructor(private readonly logger: Logger) {}

    async load(uri: vscode.Uri): Promise<V6Project> {
        const raw = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(raw).toString('utf-8');
        const data = parse(text);
        const result = validate(data);

        if (!result.ok) {
            const summary = result.errors.map(e => `${e.path}: ${e.message}`).join('; ');
            throw new V6Error(ErrorCode.CONFIG_INVALID, `Invalid project file ${uri.fsPath}: ${summary}`);
        }

        const projectDir = path.dirname(uri.fsPath);
        const run = normalizeRun(result.run);

        return {
            name: result.name,
            run: {
                executable: path.resolve(projectDir, result.run.executable),
                debugArtifact: result.run.debugArtifact ? path.resolve(projectDir, result.run.debugArtifact) : undefined,
                bootRom: result.run.bootRom ? path.resolve(projectDir, result.run.bootRom) : undefined,
                loadAddr: run.loadAddr,
                fddReadOnly: run.fddReadOnly,
                speed: run.speed,
                viewMode: run.viewMode,
            },
            uri,
        };
    }

    async save(project: V6Project): Promise<void> {
        const snapshot = { ...project, run: { ...project.run } };
        project = snapshot;
        const projectDir = path.dirname(project.uri.fsPath);
        const data = {
            name: project.name,
            run: {
                executable: path.relative(projectDir, project.run.executable),
                ...(project.run.debugArtifact && { debugArtifact: path.relative(projectDir, project.run.debugArtifact) }),
                ...(project.run.bootRom && { bootRom: path.relative(projectDir, project.run.bootRom) }),
                ...(project.run.loadAddr && { loadAddr: project.run.loadAddr }),
                ...(project.run.fddReadOnly !== undefined && { fddReadOnly: project.run.fddReadOnly }),
                ...(project.run.speed && { speed: project.run.speed }),
                ...(project.run.viewMode && { viewMode: project.run.viewMode }),
            },
        };
        const text = JSON.stringify(data, null, 2) + '\n';
        const checked = validate(data);
        if (!checked.ok) { throw new V6Error(ErrorCode.CONFIG_INVALID, checked.errors.map(error => `${error.path}: ${error.message}`).join('; ')); }
        await vscode.workspace.fs.writeFile(project.uri, Buffer.from(text, 'utf-8'));
        this.saved.fire(snapshot);
        this.logger.info(`Saved project file: ${project.uri.fsPath}`);
    }

    dispose(): void { this.saved.dispose(); }
}
