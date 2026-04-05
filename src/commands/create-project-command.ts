import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../platform/logging/logger';
import {
    Language,
    ExecType,
    expandTemplate,
    readTemplate,
    getMakefileTemplatePath,
    getSourceTemplatePath,
    getSourceFileName,
    getExecutablePath,
    validateProjectName,
} from '../templates/template-utils';

export class CreateProjectCommand {
    constructor(
        private readonly extensionPath: string,
        private readonly logger: Logger,
    ) {}

    async execute(): Promise<void> {
        const roots = vscode.workspace.workspaceFolders;
        if (!roots || roots.length === 0) {
            vscode.window.showWarningMessage('V6: Open a folder first to create a project.');
            return;
        }

        // 1. Prompt for project name
        const nameInput = await vscode.window.showInputBox({
            prompt: 'Project name',
            placeHolder: 'demo',
            validateInput: validateProjectName,
        });
        if (!nameInput) { return; }
        const name = nameInput.trim();

        // 2. Prompt for language
        const langPick = await vscode.window.showQuickPick(
            [
                { label: 'ASM', description: 'Intel 8080 assembly', value: 'asm' as Language },
                { label: 'C', description: 'C via v6c compiler', value: 'c' as Language },
            ],
            { placeHolder: 'Select language' },
        );
        if (!langPick) { return; }
        const language = langPick.value;

        // 3. Prompt for executable type
        const execPick = await vscode.window.showQuickPick(
            [
                { label: 'ROM', description: 'Direct ROM binary', value: 'rom' as ExecType },
                { label: 'FDD', description: 'Floppy disk image', value: 'fdd' as ExecType },
            ],
            { placeHolder: 'Select executable type' },
        );
        if (!execPick) { return; }
        const execType = execPick.value;

        // 4. Generate files
        const workspaceRoot = roots[0].uri.fsPath;
        const vars = {
            name,
            executable: getExecutablePath(name, execType),
        };

        try {
            await this.generateFiles(workspaceRoot, name, language, execType, vars);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`create-project: ${msg}`);
            vscode.window.showErrorMessage(`V6: Failed to create project — ${msg}`);
            return;
        }

        // 5. Info message
        vscode.window.showInformationMessage(
            'Project created. Build with `make` before running the emulator.',
        );

        // 6. Open project file
        const projectFilePath = path.join(workspaceRoot, `${name}.project.json`);
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(projectFilePath));
        await vscode.window.showTextDocument(doc);
    }

    private async generateFiles(
        root: string,
        name: string,
        language: Language,
        execType: ExecType,
        vars: Record<string, string>,
    ): Promise<void> {
        const enc = new TextEncoder();

        // Project JSON
        const projectTemplate = readTemplate(this.extensionPath, 'project/project.json.template');
        const projectContent = expandTemplate(projectTemplate, vars);
        const projectUri = vscode.Uri.file(path.join(root, `${name}.project.json`));
        await vscode.workspace.fs.writeFile(projectUri, enc.encode(projectContent));
        this.logger.info(`create-project: wrote ${projectUri.fsPath}`);

        // Makefile
        const makeTemplatePath = getMakefileTemplatePath(language, execType);
        const makeTemplate = readTemplate(this.extensionPath, makeTemplatePath);
        const makeContent = expandTemplate(makeTemplate, vars);
        const makeUri = vscode.Uri.file(path.join(root, 'Makefile'));
        await vscode.workspace.fs.writeFile(makeUri, enc.encode(makeContent));
        this.logger.info(`create-project: wrote ${makeUri.fsPath}`);

        // Source file
        const srcDir = path.join(root, 'src');
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(srcDir));
        const sourceTemplatePath = getSourceTemplatePath(language);
        const sourceTemplate = readTemplate(this.extensionPath, sourceTemplatePath);
        const sourceContent = expandTemplate(sourceTemplate, vars);
        const srcFileName = getSourceFileName(language);
        const srcUri = vscode.Uri.file(path.join(srcDir, srcFileName));
        await vscode.workspace.fs.writeFile(srcUri, enc.encode(sourceContent));
        this.logger.info(`create-project: wrote ${srcUri.fsPath}`);

        // out/ directory
        const outDir = path.join(root, 'out');
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(outDir));
    }
}
