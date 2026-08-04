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
            },
            uri: vscode.Uri.file(__filename),
        };
        const activeProjectService = {
            getActiveProject: () => project,
            resolve: async () => project,
        } as unknown as ActiveProjectService;

        return new V6DebugConfigurationProvider(activeProjectService, new Logger('test'));
    }

    it('uses the active project debug artifact instead of a launch override', async () => {
        const provider = createProvider('project/demo.elf');
        const config = await provider.resolveDebugConfiguration(undefined, {
            type: 'v6',
            request: 'launch',
            name: 'Launch demo',
            program: __filename,
            debugArtifact: 'override/demo.elf',
        });

        expect(config?.debugArtifact).to.equal('project/demo.elf');
    });

    it('removes a launch override when the active project has no debug artifact', async () => {
        const provider = createProvider();
        const config = await provider.resolveDebugConfiguration(undefined, {
            type: 'v6',
            request: 'launch',
            name: 'Launch demo',
            program: __filename,
            debugArtifact: 'override/demo.elf',
        });

        expect(config).not.to.have.property('debugArtifact');
    });
});