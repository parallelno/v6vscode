import { expect } from 'chai';
import * as path from 'path';
import * as vscode from 'vscode';
import { ProjectRepository } from '../../../src/project/persistence/project-repository';
import { V6Project } from '../../../src/project/model/v6-project';

describe('ProjectRepository', () => {
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
                viewMode: 'bordered',
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
                viewMode: 'bordered',
            },
        });
    });
});