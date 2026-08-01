import { IpcClient } from '../client/ipc-client';
import { GetServerInfoResponse, IpcCommand } from './ipc-commands';

export const SUPPORTED_IPC_PROTOCOL_VERSION = 2;
export const SUPPORTED_RAW_FRAME_SCHEMA = 1;

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
    const requiredCommands = [IpcCommand.GET_STACK_SAMPLE, IpcCommand.DEBUG_ATTACH];
    const missingCommands = requiredCommands.filter(command => !info.commands.includes(command));
    if (!info.capabilities.debugger || info.capabilities.stackSampleSchema !== 1 || missingCommands.length > 0) {
        throw new Error(`v6emul ${info.emulatorVersion} does not provide the required debugger protocol capabilities`);
    }
}