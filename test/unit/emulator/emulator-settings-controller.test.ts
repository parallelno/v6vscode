import { expect } from 'chai';
import * as vscode from 'vscode';
import { EmulatorSettingsController } from '../../../src/emulator/panel/emulator-settings-controller';
import { V6Project } from '../../../src/project/model/v6-project';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

describe('EmulatorSettingsController', () => {
    async function expectRejection(promise: Promise<unknown>, message: string): Promise<void> {
        try {
            await promise;
            expect.fail('Expected promise to reject');
        } catch (error) {
            expect(error).to.be.instanceOf(Error);
            expect((error as Error).message).to.include(message);
        }
    }

    function project(speed = '100%', viewMode = 'borderless'): V6Project {
        return { name: 'test', uri: {} as any, run: { executable: 'test.rom', speed, viewMode } };
    }

    function setup(currentProject: V6Project | undefined, connected = false) {
        const sends: Array<{ command: IpcCommand; data: unknown }> = [];
        const frameModes: string[] = [];
        let saved: V6Project | undefined;
        const client = {
            connected,
            send: async (command: IpcCommand, data: unknown) => { sends.push({ command, data }); },
        } as any;
        const lifecycle = {
            setFrameMode: async (mode: string) => { frameModes.push(mode); },
        } as any;
        const controller = new EmulatorSettingsController(
            lifecycle,
            client,
            async () => currentProject,
            async value => { saved = value; },
        );
        return { controller, sends, frameModes, saved: () => saved };
    }

    it('preserves border project values in the UI mode', async () => {
        const { controller } = setup(project('200%', 'border'));
        expect(await controller.refresh()).to.deep.equal({
            speed: '200%', viewMode: 'border', hasProject: true,
            scriptOverlaysHidden: false, scriptOverlayFontSize: 12,
        });
    });

    it('persists disconnected settings without sending IPC', async () => {
        const state = setup(project(), false);
        await state.controller.setSpeed('50%');
        await state.controller.setViewMode('border');
        expect(state.sends).to.deep.equal([]);
        expect(state.saved()!.run.speed).to.equal('50%');
        expect(state.saved()!.run.viewMode).to.equal('border');
    });

    it('sends connected speed and display updates before persisting', async () => {
        const state = setup(project(), true);
        await state.controller.setSpeed('200%');
        await state.controller.setViewMode('full');
        expect(state.sends).to.deep.equal([{ command: IpcCommand.SET_CPU_SPEED, data: { speed: 4 } }]);
        expect(state.frameModes).to.deep.equal(['full']);
        expect(state.controller.current).to.deep.equal({
            speed: '200%', viewMode: 'full', hasProject: true,
            scriptOverlaysHidden: false, scriptOverlayFontSize: 12,
        });
    });

    it('rejects unsupported values and missing projects', async () => {
        const state = setup(undefined, true);
        await expectRejection(state.controller.setSpeed('turbo'), 'Unsupported emulator speed');
        await expectRejection(state.controller.setViewMode('wide'), 'Unsupported display mode');
        await expectRejection(state.controller.setSpeed('100%'), 'No active V6 project');
    });

    it('persists overlay preferences globally and refreshes from native configuration changes', async () => {
        const workspace = vscode.workspace as any;
        const originalConfiguration = workspace.getConfiguration;
        const originalOnDidChangeConfiguration = workspace.onDidChangeConfiguration;
        const values: Record<string, unknown> = {
            'scriptOverlays.hidden': false,
            'scriptOverlays.fontSize': 12,
        };
        const updates: Array<{ key: string; value: unknown; target: unknown }> = [];
        let listener: ((event: { affectsConfiguration: (key: string) => boolean }) => void) | undefined;
        workspace.getConfiguration = () => ({
            get: (key: string) => values[key],
            update: async (key: string, value: unknown, target: unknown) => {
                values[key] = value;
                updates.push({ key, value, target });
            },
        });
        workspace.onDidChangeConfiguration = (next: typeof listener) => {
            listener = next;
            return { dispose: () => { listener = undefined; } };
        };
        try {
            const state = setup(undefined);
            await state.controller.setScriptOverlaysHidden(true);
            await state.controller.setScriptOverlayFontSize(48);
            expect(updates).to.deep.equal([
                { key: 'scriptOverlays.hidden', value: true, target: vscode.ConfigurationTarget.Global },
                { key: 'scriptOverlays.fontSize', value: 48, target: vscode.ConfigurationTarget.Global },
            ]);
            values['scriptOverlays.hidden'] = true;
            values['scriptOverlays.fontSize'] = 6;
            listener!({ affectsConfiguration: key => key === 'v6.scriptOverlays.fontSize' });
            expect(state.controller.current).to.include({
                hasProject: false, scriptOverlaysHidden: true, scriptOverlayFontSize: 6,
            });
            await expectRejection(state.controller.setScriptOverlayFontSize(5), 'Font Size must be an integer in 6..48');
            await expectRejection(state.controller.setScriptOverlayFontSize(6.5), 'Font Size must be an integer in 6..48');
            state.controller.dispose();
        } finally {
            workspace.getConfiguration = originalConfiguration;
            workspace.onDidChangeConfiguration = originalOnDidChangeConfiguration;
        }
    });
});