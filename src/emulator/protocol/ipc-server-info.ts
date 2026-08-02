import { IpcClient } from '../client/ipc-client';
import { GetServerInfoResponse, IpcCommand } from './ipc-commands';

export const SUPPORTED_IPC_PROTOCOL_VERSION = 2;
export const SUPPORTED_RAW_FRAME_SCHEMA = 1;
export const SUPPORTED_BREAKPOINT_SCHEMA = 1;
export const SUPPORTED_WATCHPOINT_SCHEMA = 1;
export const SUPPORTED_STOP_RECORD_SCHEMA = 1;
export const SUPPORTED_HARDWARE_STATS_SCHEMA = 1;

/** Reads and validates the required server metadata handshake. */
export async function getServerInfo(client: IpcClient): Promise<GetServerInfoResponse> {
    const response = await client.send<GetServerInfoResponse>(IpcCommand.GET_SERVER_INFO);
    if (!response.ok) {
        throw new Error(
            `GET_SERVER_INFO failed (${response.code ?? 'unknown_error'}): ${response.error ?? 'unknown error'}`,
        );
    }

    const info = response.data;
    if (!info || typeof info.protocolVersion !== 'number') {
        throw new Error('GET_SERVER_INFO returned invalid server metadata');
    }
    if (info.protocolVersion !== SUPPORTED_IPC_PROTOCOL_VERSION) {
        throw new Error(
            `Unsupported v6emul IPC protocol ${info.protocolVersion}; `
            + `expected ${SUPPORTED_IPC_PROTOCOL_VERSION}`,
        );
    }
    if (info.capabilities?.rawFrameSchema !== SUPPORTED_RAW_FRAME_SCHEMA
        || !Array.isArray(info.commands)
        || !info.commands.includes(IpcCommand.GET_FRAME_RAW)) {
        throw new Error(
            `v6emul ${info.emulatorVersion ?? 'unknown'} does not provide raw-frame schema `
            + `${SUPPORTED_RAW_FRAME_SCHEMA}`,
        );
    }
    return info;
}

export function validateDebuggerServer(info: GetServerInfoResponse): void {
    const requiredCommands = [
        IpcCommand.GET_STACK_SAMPLE,
        IpcCommand.DEBUG_ATTACH,
        IpcCommand.DEBUG_BREAKPOINT_ADD,
        IpcCommand.DEBUG_BREAKPOINT_DEL,
        IpcCommand.DEBUG_BREAKPOINT_GET_ALL,
        IpcCommand.DEBUG_BREAKPOINT_GET_UPDATES,
    ];
    const missingCommands = requiredCommands.filter(command => !info.commands.includes(command));
    if (!info.capabilities.debugger
        || info.capabilities.stackSampleSchema !== 1
        || info.capabilities.breakpointSchema !== SUPPORTED_BREAKPOINT_SCHEMA
        || missingCommands.length > 0) {
        throw new Error(`v6emul ${info.emulatorVersion} does not provide the required debugger protocol capabilities`);
    }
}

export function validateWatchpointServer(info: GetServerInfoResponse): void {
    const requiredCommands = [
        IpcCommand.DEBUG_WATCHPOINT_ADD,
        IpcCommand.DEBUG_WATCHPOINT_EDIT,
        IpcCommand.DEBUG_WATCHPOINT_DEL_ALL,
        IpcCommand.DEBUG_WATCHPOINT_DEL,
        IpcCommand.DEBUG_WATCHPOINT_GET_UPDATES,
        IpcCommand.DEBUG_WATCHPOINT_GET_ALL,
    ];
    const missingCommands = requiredCommands.filter(command => !info.commands.includes(command));
    if (info.capabilities.watchpointSchema !== SUPPORTED_WATCHPOINT_SCHEMA
        || info.capabilities.watchpointServerAllocatedIds !== true
        || info.capabilities.watchpointEdit !== true
        || missingCommands.length > 0) {
        throw new Error(`v6emul ${info.emulatorVersion} does not provide the required watchpoint protocol capabilities`);
    }
}

export function supportsStopRecords(info: GetServerInfoResponse): boolean {
    return info.capabilities.stopRecordSchema === SUPPORTED_STOP_RECORD_SCHEMA
        && info.commands.includes(IpcCommand.GET_STOP_RECORD);
}

export function validateHardwareStatisticsServer(info: GetServerInfoResponse): void {
    const requiredCommands = [
        IpcCommand.GET_HARDWARE_STATS,
        IpcCommand.SET_IO_PALETTE_ENTRY,
        IpcCommand.DISMOUNT_FDD,
        IpcCommand.MOUNT_FDD,
    ];
    if (info.capabilities.hardwareStatsSchema !== SUPPORTED_HARDWARE_STATS_SCHEMA
        || info.capabilities.paletteEntryMutation !== true
        || info.capabilities.fddDismount !== true
        || requiredCommands.some(command => !info.commands.includes(command))) {
        throw new Error(`v6emul ${info.emulatorVersion} does not provide hardware statistics schema 1`);
    }
}