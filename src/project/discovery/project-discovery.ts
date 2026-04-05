import * as vscode from 'vscode';

export class ProjectDiscovery {
    async findProjects(roots: vscode.Uri[]): Promise<vscode.Uri[]> {
        const results: vscode.Uri[] = [];
        for (const root of roots) {
            const pattern = new vscode.RelativePattern(root, '*.project.json');
            const files = await vscode.workspace.findFiles(pattern);
            results.push(...files);
        }
        return results;
    }
}
