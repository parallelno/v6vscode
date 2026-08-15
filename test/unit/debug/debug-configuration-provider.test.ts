import { expect } from 'chai';
import * as vscode from 'vscode';
import { V6DebugConfigurationProvider } from '../../../src/debug/configuration/debug-configuration-provider';
import { ActiveProjectService } from '../../../src/project/active/active-project-service';
import { Logger } from '../../../src/platform/logging/logger';

describe('V6DebugConfigurationProvider', () => {
    function createProvider(debugArtifact?: string): V6DebugConfigurationProvider {
        const project = {
            name: 'demo',
            run: {
                executable: __filename,
                debugArtifact,
                loadAddr: '0x100',
                speed: '100%',
            },
            uri: vscode.Uri.file(__filename),
        };
        const activeProjectService = {
            getActiveProject: () => project,
            resolve: async () => project,
        } as unknown as ActiveProjectService;

        return new V6DebugConfigurationProvider(activeProjectService, new Logger('test'));
    }

    it('uses the active project launch settings instead of launch overrides', async () => {
        const provider = createProvider('project/demo.elf');
        const config = await provider.resolveDebugConfiguration(undefined, {
            type: 'v6',
            request: 'launch',
            name: 'Launch demo',
            program: 'override/demo.rom',
            debugArtifact: 'override/demo.elf',
            loadAddress: '0x200',
            speed: '50%',
            stopOnEntry: true,
        });

        expect(config?.program).to.equal(__filename);
        expect(config?.debugArtifact).to.equal('project/demo.elf');
        expect(config).to.have.property('loadAddress', '0x100');
        expect(config).to.have.property('speed', '100%');
        expect(config).not.to.have.property('stopOnEntry');
    });

    it('removes a launch override when the active project has no debug artifact', async () => {
        const provider = createProvider();
        const config = await provider.resolveDebugConfiguration(undefined, {
            type: 'v6',
            request: 'launch',
            name: 'Launch demo',
            program: 'override/demo.rom',
            debugArtifact: 'override/demo.elf',
        });

        expect(config).not.to.have.property('debugArtifact');
    });

    it('reloads project launch settings for each debug session', async () => {
        const firstProject = {
            name: 'demo',
            run: { executable: __filename, loadAddr: '0x100', speed: '100%' },
            uri: vscode.Uri.file(__filename),
        };
        const secondProject = {
            ...firstProject,
            run: { ...firstProject.run, executable: process.execPath },
        };
        let project = firstProject;
        const activeProjectService = {
            getActiveProject: () => firstProject,
            resolve: async () => project,
        } as unknown as ActiveProjectService;
        const provider = new V6DebugConfigurationProvider(activeProjectService, new Logger('test'));

        await provider.resolveDebugConfiguration(undefined, {
            type: 'v6', request: 'launch', name: 'Launch demo',
        });
        project = secondProject;
        const config = await provider.resolveDebugConfiguration(undefined, {
            type: 'v6', request: 'launch', name: 'Launch demo',
        });

        expect(config?.program).to.equal(secondProject.run.executable);
    });

    it('generates a launch configuration without project runtime settings', async () => {
        const provider = createProvider('project/demo.elf');
        const [config] = await provider.provideDebugConfigurations(undefined);

        expect(config).to.deep.equal({
            type: 'v6',
            request: 'launch',
            name: 'Launch demo',
        });
    });
});