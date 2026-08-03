import { expect } from 'chai';
import {
    getServerInfo,
    supportsStopRecords,
    validateDebuggerServer,
    validateHardwareStatisticsServer,
    validateMemoryEditServer,
    validatePerformanceServer,
    validateWatchpointServer,
} from '../../../src/emulator/protocol/ipc-server-info';
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
            protocolVersion: 2,
            emulatorVersion: '2026.07.30-test',
            commands: [-5, -4, -3, -1, 18, 51],
            capabilities: {
                debugger: true,
                rawFrame: true,
                rawFrameSchema: 1,
                stackSampleSchema: 1,
                breakpointSchema: 1,
            },
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
                protocolVersion: 3,
                emulatorVersion: 'future',
                commands: [-4],
                capabilities: { debugger: true, rawFrame: true, rawFrameSchema: 1, stackSampleSchema: 1 },
            },
        });

        let message = '';
        try {
            await getServerInfo(client);
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        expect(message).to.contain('Unsupported v6emul IPC protocol 3');
    });

    it('rejects missing raw-frame schema and command support', async () => {
        const base = {
            protocolVersion: 2,
            emulatorVersion: 'test-build',
            commands: [-4],
            capabilities: { debugger: true, rawFrame: true, rawFrameSchema: 1, stackSampleSchema: 1 },
        };

        for (const data of [
            { ...base, commands: [] },
            { ...base, capabilities: { ...base.capabilities, rawFrameSchema: 2 } },
        ]) {
            let message = '';
            try {
                await getServerInfo(makeClient({ ok: true, data }));
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
            }
            expect(message).to.contain('does not provide raw-frame schema 1');
        }
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
        protocolVersion: 2,
        emulatorVersion: 'test-build',
        commands: [
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

    it('accepts the required debugger contract', () => {
        expect(() => validateDebuggerServer(validInfo)).not.to.throw();
    });

    it('rejects missing capabilities and commands', () => {
        expect(() => validateDebuggerServer({
            ...validInfo,
            commands: validInfo.commands.filter(command => command !== IpcCommand.DEBUG_BREAKPOINT_ADD),
        })).to.throw('does not provide the required debugger protocol capabilities');

        expect(() => validateDebuggerServer({
            ...validInfo,
            capabilities: { ...validInfo.capabilities, stackSampleSchema: 2 },
        })).to.throw('does not provide the required debugger protocol capabilities');

        expect(() => validateDebuggerServer({
            ...validInfo,
            capabilities: { ...validInfo.capabilities, breakpointSchema: undefined },
        })).to.throw('does not provide the required debugger protocol capabilities');
    });
});

describe('supportsStopRecords', () => {
    const info = {
        protocolVersion: 2,
        emulatorVersion: 'test-build',
        commands: [IpcCommand.GET_STOP_RECORD],
        capabilities: {
            debugger: true,
            rawFrame: true,
            rawFrameSchema: 1,
            stackSampleSchema: 1,
            stopRecordSchema: 1,
        },
    };

    it('requires both command 95 and schema 1', () => {
        expect(supportsStopRecords(info)).to.equal(true);
        expect(supportsStopRecords({ ...info, commands: [] })).to.equal(false);
        expect(supportsStopRecords({
            ...info, capabilities: { ...info.capabilities, stopRecordSchema: undefined },
        })).to.equal(false);
    });
});

describe('validateMemoryEditServer', () => {
    const info = {
        protocolVersion: 2,
        emulatorVersion: 'test-build',
        commands: [
            IpcCommand.DEBUG_MEMORY_EDIT_ADD,
            IpcCommand.DEBUG_MEMORY_EDIT_DEL_ALL,
            IpcCommand.DEBUG_MEMORY_EDIT_DEL,
            IpcCommand.DEBUG_MEMORY_EDIT_GET,
            IpcCommand.DEBUG_MEMORY_EDIT_EXISTS,
            IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL,
            IpcCommand.DEBUG_MEMORY_EDIT_RESTORE,
        ],
        capabilities: {
            debugger: true,
            rawFrame: true,
            rawFrameSchema: 1,
            stackSampleSchema: 1,
            memoryEditSchema: 1,
            memoryEditLimits: { globalAddressExclusive: 0x210000, maxCommentBytes: 1024 },
        },
    };

    it('requires schema 1, limits, and the complete request set', () => {
        expect(() => validateMemoryEditServer(info)).not.to.throw();
        expect(() => validateMemoryEditServer({
            ...info,
            commands: info.commands.filter(command => command !== IpcCommand.DEBUG_MEMORY_EDIT_RESTORE),
        }))
            .to.throw('does not provide memory-edit schema 1');
        expect(() => validateMemoryEditServer({
            ...info, capabilities: { ...info.capabilities, memoryEditLimits: undefined },
        })).to.throw('does not provide memory-edit schema 1');
    });
});

describe('validateWatchpointServer', () => {
    const validInfo = {
        protocolVersion: 2,
        emulatorVersion: 'test-build',
        commands: [
            IpcCommand.DEBUG_WATCHPOINT_ADD,
            IpcCommand.DEBUG_WATCHPOINT_EDIT,
            IpcCommand.DEBUG_WATCHPOINT_DEL_ALL,
            IpcCommand.DEBUG_WATCHPOINT_DEL,
            IpcCommand.DEBUG_WATCHPOINT_GET_UPDATES,
            IpcCommand.DEBUG_WATCHPOINT_GET_ALL,
        ],
        capabilities: {
            debugger: true,
            rawFrame: true,
            rawFrameSchema: 1,
            stackSampleSchema: 1,
            watchpointSchema: 1,
            watchpointServerAllocatedIds: true,
            watchpointEdit: true,
            watchpointMutationsWhileRunning: true,
        },
    };

    it('accepts structured watchpoint editing', () => {
        expect(() => validateWatchpointServer(validInfo)).not.to.throw();
    });

    it('rejects servers without command 94 or the edit capability', () => {
        expect(() => validateWatchpointServer({
            ...validInfo,
            commands: validInfo.commands.filter(command => command !== IpcCommand.DEBUG_WATCHPOINT_EDIT),
        })).to.throw('does not provide the required watchpoint protocol capabilities');

        expect(() => validateWatchpointServer({
            ...validInfo,
            capabilities: { ...validInfo.capabilities, watchpointEdit: false },
        })).to.throw('does not provide the required watchpoint protocol capabilities');
    });
});

describe('validateHardwareStatisticsServer', () => {
    const validInfo = {
        protocolVersion: 2,
        emulatorVersion: 'test-build',
        commands: [
            IpcCommand.GET_HARDWARE_STATS,
            IpcCommand.SET_IO_PALETTE_ENTRY,
            IpcCommand.DISMOUNT_FDD,
            IpcCommand.MOUNT_FDD,
        ],
        capabilities: {
            debugger: true,
            rawFrame: true,
            rawFrameSchema: 1,
            stackSampleSchema: 1,
            hardwareStatsSchema: 1,
            hardwareStatsWhileRunning: true,
            paletteEntryMutation: true,
            fddDismount: true,
            runningHardwareMutations: false,
        },
    };

    it('accepts commands 96..98 and hardware statistics schema 1', () => {
        expect(() => validateHardwareStatisticsServer(validInfo)).not.to.throw();
    });

    it('rejects missing commands and mutation capabilities', () => {
        expect(() => validateHardwareStatisticsServer({
            ...validInfo,
            commands: validInfo.commands.filter(command => command !== IpcCommand.DISMOUNT_FDD),
        })).to.throw('hardware statistics schema 1');
        expect(() => validateHardwareStatisticsServer({
            ...validInfo,
            capabilities: { ...validInfo.capabilities, paletteEntryMutation: false },
        })).to.throw('hardware statistics schema 1');
    });
});

describe('validatePerformanceServer', () => {
    const info = {
        protocolVersion: 2,
        emulatorVersion: 'test-build',
        commands: [
            IpcCommand.DEBUG_CODE_PERF_ADD,
            IpcCommand.DEBUG_CODE_PERF_DEL_ALL,
            IpcCommand.DEBUG_CODE_PERF_DEL,
            IpcCommand.DEBUG_CODE_PERF_GET,
            IpcCommand.DEBUG_CODE_PERF_EXISTS,
            IpcCommand.DEBUG_CODE_PERF_GET_ALL,
            IpcCommand.DEBUG_CODE_PERF_EDIT,
        ],
        capabilities: {
            debugger: true,
            rawFrame: true,
            rawFrameSchema: 1,
            stackSampleSchema: 1,
            codePerfSchema: 1,
            codePerfServerAllocatedIds: true,
            codePerfEdit: true,
            codePerfMutationsWhileRunning: true,
            codePerfLimits: {
                addressExclusive: 0x10000,
                maxNameBytes: 1024,
                maxRecords: 256,
                maxTestCount: 20000,
            },
        },
    };

    it('requires schema 1, all capabilities, limits, and the complete command set', () => {
        expect(() => validatePerformanceServer(info)).not.to.throw();
        for (const command of info.commands) {
            expect(() => validatePerformanceServer({
                ...info, commands: info.commands.filter(candidate => candidate !== command),
            })).to.throw('does not provide CodePerf schema 1');
        }
        for (const capability of [
            'codePerfServerAllocatedIds', 'codePerfEdit', 'codePerfMutationsWhileRunning',
        ] as const) {
            expect(() => validatePerformanceServer({
                ...info, capabilities: { ...info.capabilities, [capability]: false },
            })).to.throw('does not provide CodePerf schema 1');
        }
        expect(() => validatePerformanceServer({
            ...info, capabilities: { ...info.capabilities, codePerfLimits: undefined },
        })).to.throw('does not provide CodePerf schema 1');
    });
});