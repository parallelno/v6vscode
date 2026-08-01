import { expect } from 'chai';
import { getServerInfo, validateDebuggerServer } from '../../../src/emulator/protocol/ipc-server-info';
import { IpcCommand, IpcResponse } from '../../../src/emulator/protocol/ipc-commands';

describe('getServerInfo', () => {
    function makeClient(response: IpcResponse): any {
        return {
            send: async (command: IpcCommand) => {
                expect(command).to.equal(IpcCommand.GET_SERVER_INFO);
                return response;
            },
        };
    }

    it('accepts the supported protocol and returns server metadata', async () => {
        const data = {
            protocolVersion: 1,
            emulatorVersion: '2026.07.30-test',
            commands: [-5, -4, -3, -1, 18, 51],
            capabilities: { debugger: true, rawFrame: true, stackSampleSchema: 1 },
        };

        expect(await getServerInfo(makeClient({ ok: true, data }))).to.deep.equal(data);
    });

    it('rejects a server without GET_SERVER_INFO', async () => {
        const client = makeClient({
            ok: false,
            code: 'unknown_command',
            error: 'unsupported command',
        });

        let message = '';
        try {
            await getServerInfo(client);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.equal('GET_SERVER_INFO failed (unknown_command): unsupported command');
    });

    it('rejects missing server metadata', async () => {
        let message = '';
        try {
            await getServerInfo(makeClient({ ok: true, data: {} }));
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.equal('GET_SERVER_INFO returned invalid server metadata');
    });

    it('rejects an incompatible protocol version', async () => {
        const client = makeClient({
            ok: true,
            data: {
                protocolVersion: 2,
                emulatorVersion: 'future',
                commands: [],
                capabilities: { debugger: true, rawFrame: true, stackSampleSchema: 1 },
            },
        });

        let message = '';
        try {
            await getServerInfo(client);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.contain('Unsupported v6emul IPC protocol 2');
    });

    it('preserves structured server failures', async () => {
        const client = makeClient({ ok: false, code: 'internal_error', error: 'server failure' });

        let message = '';
        try {
            await getServerInfo(client);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.equal('GET_SERVER_INFO failed (internal_error): server failure');
    });
});

describe('validateDebuggerServer', () => {
    const validInfo = {
        protocolVersion: 1,
        emulatorVersion: 'test-build',
        commands: [IpcCommand.GET_STACK_SAMPLE, IpcCommand.DEBUG_ATTACH],
        capabilities: { debugger: true, rawFrame: true, stackSampleSchema: 1 },
    };

    it('accepts the required debugger contract', () => {
        expect(() => validateDebuggerServer(validInfo)).not.to.throw();
    });

    it('rejects missing capabilities and commands', () => {
        expect(() => validateDebuggerServer({
            ...validInfo,
            commands: [IpcCommand.DEBUG_ATTACH],
        })).to.throw('does not provide the required debugger protocol capabilities');

        expect(() => validateDebuggerServer({
            ...validInfo,
            capabilities: { ...validInfo.capabilities, stackSampleSchema: 2 },
        })).to.throw('does not provide the required debugger protocol capabilities');
    });
});