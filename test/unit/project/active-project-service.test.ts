import * as assert from 'assert';
import * as vscode from 'vscode';
import { ActiveProjectService } from '../../../src/project/active/active-project-service';
import { DebugSymbolService } from '../../../src/debug/metadata/debug-symbol-service';
import { ArtifactRepository } from '../../../src/debug/metadata/artifact-repository';
import { buildDebugIndex } from '../../../src/debug/metadata/debug-index';

describe('Artifact project selection', () => {
    it('publishes relevant project changes and detaches independent consumer listeners', async () => {
        const uri = vscode.Uri.file('C:\\projects\\demo.project.json');
        let project = { uri, name: 'demo', run: { executable: 'first.rom', debugArtifact: 'first.elf' } };
        let paths = [uri];
        const projects = new ActiveProjectService({ findProjects: async () => paths } as any,
            { load: async () => project } as any, { getRootUris: () => [] } as any,
            { info() {} } as any);
        let changes = 0;
        const subscription = projects.onDidChange(() => changes++);
        const index = buildDebugIndex([], [], '');
        const repository = new ArtifactRepository({ read: async () => ({ elf: Buffer.from([1]) }) },
            () => ({ index, metadata: undefined, compDir: '', validationWarning: undefined }));
        const first = new DebugSymbolService(repository).followProject(projects);
        const second = new DebugSymbolService(repository).followProject(projects);
        await projects.resolve();
        await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(changes, 1);
        assert.strictEqual(first.snapshot, second.snapshot);
        await projects.resolve();
        assert.strictEqual(changes, 1);
        project = { ...project, run: { executable: 'second.rom', debugArtifact: 'second.elf' } };
        await projects.resolve();
        await new Promise(resolve => setImmediate(resolve));
        assert.strictEqual(changes, 2);
        assert.ok(first.snapshot?.artifactPath.endsWith('second.elf'));
        first.dispose();
        paths = [];
        await projects.resolve();
        assert.strictEqual(changes, 3);
        assert.strictEqual(second.snapshot, undefined);
        second.dispose(); subscription.dispose(); projects.dispose();
    });

    it('does not publish an older project load after a newer resolve completes', async () => {
        const uri = vscode.Uri.file('C:\\projects\\demo.project.json');
        let finish!: (value: any) => void;
        let reads = 0;
        const newer = { uri, name: 'newer', run: { executable: 'new.rom' } };
        const projects = new ActiveProjectService({ findProjects: async () => [uri] } as any,
            { load: async () => ++reads === 1 ? new Promise(resolve => { finish = resolve; }) : newer } as any,
            { getRootUris: () => [] } as any, { info() {} } as any);
        const first = projects.resolve();
        await new Promise(resolve => setImmediate(resolve));
        await projects.resolve();
        finish({ ...newer, name: 'old', run: { executable: 'old.rom' } });
        await first;
        assert.strictEqual(projects.getActiveProject(), newer);
        projects.dispose();
    });
});