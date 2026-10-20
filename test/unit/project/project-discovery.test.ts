import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectDiscovery } from '../../../src/project/discovery/project-discovery';
import { ActiveProjectService } from '../../../src/project/active/active-project-service';

describe('Project resolution anchors and discovery scope', () => {
    it('enumerates each supplied workspace with the existing root-level pattern, not a source ancestor search', async () => {
        const roots = [vscode.Uri.file(path.resolve('workspace-one')), vscode.Uri.file(path.resolve('workspace-two'))];
        const calls: vscode.RelativePattern[] = [];
        const workspace = vscode.workspace as unknown as { findFiles(pattern: vscode.RelativePattern): Promise<vscode.Uri[]> };
        const original = workspace.findFiles;
        workspace.findFiles = async pattern => { calls.push(pattern); return [vscode.Uri.file(path.join(roots[calls.length - 1].fsPath, 'game.project.json'))]; };
        try {
            const found = await new ProjectDiscovery().findProjects(roots);
            assert.strictEqual(found.length, 2); assert.strictEqual(calls.length, 2);
            assert.ok(calls.every(pattern => pattern.pattern === '*.project.json'));
            assert.deepStrictEqual(await new ProjectDiscovery().findProjects([]), []);
        } finally { workspace.findFiles = original; }
    });

    it('uses explicit multi-project selection rather than the first folder and preserves exact URI save identity', async () => {
        const first = vscode.Uri.file(path.resolve('workspace-one', 'one.project.json'));
        const second = vscode.Uri.file(path.resolve('workspace-two', 'two.project.json'));
        const project = { name: 'two', uri: second, run: { executable: 'two.rom' } };
        const window = vscode.window as unknown as { showQuickPick: (items: Array<{ uri: vscode.Uri }>) => Promise<{ uri: vscode.Uri }> };
        const original = window.showQuickPick;
        let onSave!: (saved: typeof project) => void;
        const active = new ActiveProjectService({ findProjects: async () => [first, second] } as never,
            { load: async (uri: vscode.Uri) => { assert.strictEqual(uri, second); return project; },
                onDidSave: (listener: typeof onSave) => { onSave = listener; return { dispose() {} }; } } as never,
            { getRootUris: () => [] } as never, { info() {} } as never);
        window.showQuickPick = async items => items[1];
        try {
            assert.strictEqual(await active.resolve(), project);
            onSave({ ...project, uri: vscode.Uri.file(second.fsPath.toUpperCase()), run: { executable: 'other.rom' } });
            assert.strictEqual(active.getActiveProject(), project);
        } finally { active.dispose(); window.showQuickPick = original; }
    });
});