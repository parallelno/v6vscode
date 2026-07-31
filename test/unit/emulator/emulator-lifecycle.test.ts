import { expect } from 'chai';
import { EmulatorLifecycle } from '../../../src/emulator/lifecycle/emulator-lifecycle';

describe('EmulatorLifecycle session ownership', () => {
    function makeLifecycle(): EmulatorLifecycle {
        return new EmulatorLifecycle(
            {} as any,
            {} as any,
            { connected: false, disconnect: () => {} } as any,
            { info: () => {}, error: () => {} } as any,
            {} as any,
        );
    }

    it('stops a debug-owned session when the display closes', async () => {
        const lifecycle = makeLifecycle();
        (lifecycle as any)._owner = 'debug';
        let stopped = false;
        lifecycle.stop = async () => { stopped = true; };

        await lifecycle.stopFromDisplay();

        expect(stopped).to.equal(true);
        expect(lifecycle.owner).to.equal('debug');
    });

    it('stops a run-owned session when the display closes', async () => {
        const lifecycle = makeLifecycle();
        (lifecycle as any)._owner = 'run';
        let stopped = false;
        lifecycle.stop = async () => { stopped = true; };

        await lifecycle.stopFromDisplay();

        expect(stopped).to.equal(true);
    });

    it('publishes running and paused state for shared consumers', () => {
        const lifecycle = makeLifecycle();
        (lifecycle as any)._state = 'connected';
        const states: string[] = [];
        lifecycle.on('stateChange', state => states.push(state));

        lifecycle.setExecutionRunning(true);
        lifecycle.setExecutionRunning(false);

        expect(states).to.deep.equal(['running', 'connected']);
    });
});