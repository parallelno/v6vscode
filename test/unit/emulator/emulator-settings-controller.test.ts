import { expect } from 'chai';
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

    it('maps bordered project values to the border UI mode', async () => {
        const { controller } = setup(project('200%', 'bordered'));
        expect(await controller.refresh()).to.deep.equal({ speed: '200%', viewMode: 'border', hasProject: true });
    });

    it('persists disconnected settings without sending IPC', async () => {
        const state = setup(project(), false);
        await state.controller.setSpeed('50%');
        await state.controller.setViewMode('border');
        expect(state.sends).to.deep.equal([]);
        expect(state.saved()!.run.speed).to.equal('50%');
        expect(state.saved()!.run.viewMode).to.equal('bordered');
    });

    it('sends connected speed and display updates before persisting', async () => {
        const state = setup(project(), true);
        await state.controller.setSpeed('200%');
        await state.controller.setViewMode('full');
        expect(state.sends).to.deep.equal([{ command: IpcCommand.SET_CPU_SPEED, data: { speed: 4 } }]);
        expect(state.frameModes).to.deep.equal(['full']);
        expect(state.controller.current).to.deep.equal({ speed: '200%', viewMode: 'full', hasProject: true });
    });

    it('rejects unsupported values and missing projects', async () => {
        const state = setup(undefined, true);
        await expectRejection(state.controller.setSpeed('turbo'), 'Unsupported emulator speed');
        await expectRejection(state.controller.setViewMode('wide'), 'Unsupported display mode');
        await expectRejection(state.controller.setSpeed('100%'), 'No active V6 project');
    });
});