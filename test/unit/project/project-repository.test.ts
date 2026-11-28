import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectRepository } from '../../../src/project/persistence/project-repository';
import { V6Project } from '../../../src/project/model/v6-project';

describe('ProjectRepository', () => {
    it('round-trips script setup and merges overlapping run-setting updates', async () => {
        const projectDir = path.resolve('demo');
        const uri = vscode.Uri.file(path.join(projectDir, 'demo.project.json'));
        const source = path.join(projectDir, 'out', 'sample.lua');
        let text = JSON.stringify({ name: 'demo', run: { executable: 'out/demo.rom' } });
        const workspace = vscode.workspace as unknown as { fs: unknown };
        const originalFs = workspace.fs;
        workspace.fs = {
            readFile: async () => Buffer.from(text),
            writeFile: async (_uri: vscode.Uri, bytes: Uint8Array) => { text = Buffer.from(bytes).toString(); },
        };
        try {
            const repository = new ProjectRepository({ info: () => {} } as any);
            await Promise.all([
                repository.updateRun(uri, { scripts: [{ name: 'Sample', path: source, active: false, useDebugSymbols: true }] }),
                repository.updateRun(uri, { speed: '200%' }),
            ]);
            expect(JSON.parse(text).run.scripts).to.deep.equal([{ name: 'Sample', path: 'out/sample.lua', active: false, useDebugSymbols: true }]);
            expect((await repository.load(uri)).run).to.include({ speed: '200%' });
            expect((await repository.load(uri)).run.scripts).to.deep.equal([{ name: 'Sample', path: source, active: false, useDebugSymbols: true }]);
            await repository.updateRun(uri, { scripts: [] });
            expect((await repository.load(uri)).run.scripts).to.deep.equal([]);
        } finally { workspace.fs = originalFs; }
    });

    it('should save debug artifact, emulator speed, and display mode', async () => {
        let savedUri: vscode.Uri | undefined;
        let savedText = '';
        const workspace = vscode.workspace as unknown as {
            fs: { writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> };
        };
        const originalFs = workspace.fs;
        workspace.fs = {
            writeFile: async (uri, content) => {
                savedUri = uri;
                savedText = Buffer.from(content).toString('utf-8');
            },
        };

        const project: V6Project = {
            name: 'demo',
            uri: vscode.Uri.file('/workspace/demo.project.json'),
            run: {
                executable: '/workspace/out/demo.rom',
                debugArtifact: '/workspace/out/demo.elf',
                speed: '200%',
                viewMode: 'border',
            },
        };

        try {
            const repository = new ProjectRepository({ info: () => {} } as any);
            await repository.save(project);
        } finally {
            workspace.fs = originalFs;
        }

        expect(savedUri!.fsPath).to.equal('/workspace/demo.project.json');
        expect(JSON.parse(savedText)).to.deep.equal({
            name: 'demo',
            run: {
                executable: path.join('out', 'demo.rom'),
                debugArtifact: path.join('out', 'demo.elf'),
                speed: '200%',
                viewMode: 'border',
            },
        });
    });
});