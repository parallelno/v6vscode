import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EmulatorLifecycle } from '../../../src/emulator/lifecycle/emulator-lifecycle';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

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

    it('disconnects a debug-owned session without terminating the emulator process', () => {
        let disconnected = false;
        let killed = false;
        const lifecycle = new EmulatorLifecycle(
            {} as any,
            {} as any,
            { connected: true, disconnect: () => { disconnected = true; } } as any,
            { info: () => {} } as any,
            {} as any,
        );
        (lifecycle as any)._state = 'connected';
        (lifecycle as any)._owner = 'debug';
        (lifecycle as any)._serverInfo = { emulatorVersion: 'test' };
        (lifecycle as any).emulatorProcess = {
            spawnResult: { process: { kill: () => { killed = true; } } },
        };

        lifecycle.disconnect();

        expect(disconnected).to.equal(true);
        expect(killed).to.equal(false);
        expect(lifecycle.state).to.equal('stopped');
        expect(lifecycle.owner).to.equal(null);
        expect(lifecycle.serverInfo).to.equal(undefined);
    });

    it('starts a debug server without loading the program', async () => {
        let launchRequest: any;
        const serverInfo = {
            protocolVersion: 2,
            emulatorVersion: 'test-build',
            commands: [
                IpcCommand.GET_FRAME_RAW,
                IpcCommand.GET_STACK_SAMPLE,
                IpcCommand.DEBUG_ATTACH,
                IpcCommand.DEBUG_BREAKPOINT_ADD,
                IpcCommand.DEBUG_BREAKPOINT_DEL,
                IpcCommand.DEBUG_BREAKPOINT_GET_ALL,
                IpcCommand.DEBUG_BREAKPOINT_GET_UPDATES,
            ],
            capabilities: {
                debugger: true,
                rawFrame: true,
                rawFrameSchema: 1,
                stackSampleSchema: 1,
                breakpointSchema: 1,
            },
        };
        const client = {
            connected: true,
            connect: async () => {},
            disconnect: () => {},
            send: async (command: IpcCommand) => command === IpcCommand.GET_SERVER_INFO
                ? { ok: true, data: serverInfo }
                : { ok: true },
        };
        const lifecycle = new EmulatorLifecycle(
            { resolve: () => 'v6emul' } as any,
            {
                launch: (request: any) => {
                    launchRequest = request;
                    return {
                        port: request.tcpPort,
                        spawnResult: { process: {}, exitPromise: new Promise(() => {}) },
                    };
                },
            } as any,
            client as any,
            { info: () => {}, error: () => {}, debug: () => {} } as any,
            {} as any,
        );
        (lifecycle as any).findFreePort = async () => 4321;

        await lifecycle.startDebug({
            program: 'test.rom',
            bootRomPath: 'boot.bin',
            loadAddr: '0x100',
        });

        expect(launchRequest).to.include({
            emulatorPath: 'v6emul',
            tcpPort: 4321,
            bootRomPath: 'boot.bin',
        });
        expect(launchRequest).not.to.have.property('romPath');
        expect(launchRequest).not.to.have.property('fddPath');
        expect(launchRequest).not.to.have.property('loadAddr');
    });

    it('loads the debug ROM paused after breakpoint configuration', async () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-debug-'));
        const romPath = path.join(tempDir, 'test.rom');
        fs.writeFileSync(romPath, Buffer.from([0x00, 0x76]));
        const requests: Array<{ command: IpcCommand; data: any }> = [];
        const lifecycle = new EmulatorLifecycle(
            {} as any,
            {} as any,
            {
                connected: true,
                disconnect: () => {},
                send: async (command: IpcCommand, data: any) => {
                    requests.push({ command, data });
                    return { ok: true };
                },
            } as any,
            { info: () => {}, error: () => {} } as any,
            {} as any,
        );
        (lifecycle as any)._state = 'connected';

        try {
            await lifecycle.loadDebugProgram({
                program: romPath,
                bootRomPath: 'boot.bin',
                loadAddr: '0x200',
            });
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        expect(requests).to.deep.equal([{
            command: IpcCommand.LOAD_ROM,
            data: { data: [0x00, 0x76], addr: 0x200, autorun: false },
        }]);
    });
});
