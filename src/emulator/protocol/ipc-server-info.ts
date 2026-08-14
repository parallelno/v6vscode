import { IpcClient } from '../client/ipc-client';
import { GetServerInfoResponse, IpcCommand } from './ipc-commands';

export const SUPPORTED_IPC_PROTOCOL_VERSION = 2;
export const SUPPORTED_RAW_FRAME_SCHEMA = 1;
export const SUPPORTED_BREAKPOINT_SCHEMA = 1;
export const SUPPORTED_WATCHPOINT_SCHEMA = 1;
export const SUPPORTED_MEMORY_EDIT_SCHEMA = 1;
export const SUPPORTED_CODE_PERF_SCHEMA = 1;
export const SUPPORTED_STOP_RECORD_SCHEMA = 1;
export const SUPPORTED_HARDWARE_STATS_SCHEMA = 1;
export const SUPPORTED_TRACE_LOG_SCHEMA = 1;
export const SUPPORTED_SCRIPT_SCHEMA = 1;
export const SUPPORTED_SCRIPT_OVERLAY_SCHEMA = 1;

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

export function validateMemoryEditServer(info: GetServerInfoResponse): void {
    const requiredCommands = [
        IpcCommand.DEBUG_MEMORY_EDIT_ADD,
        IpcCommand.DEBUG_MEMORY_EDIT_DEL_ALL,
        IpcCommand.DEBUG_MEMORY_EDIT_DEL,
        IpcCommand.DEBUG_MEMORY_EDIT_GET,
        IpcCommand.DEBUG_MEMORY_EDIT_EXISTS,
        IpcCommand.DEBUG_MEMORY_EDIT_GET_ALL,
        IpcCommand.DEBUG_MEMORY_EDIT_RESTORE,
    ];
    const limits = info.capabilities.memoryEditLimits;
    if (info.capabilities.memoryEditSchema !== SUPPORTED_MEMORY_EDIT_SCHEMA
        || !limits
        || !Number.isSafeInteger(limits.globalAddressExclusive)
        || limits.globalAddressExclusive <= 0
        || !Number.isSafeInteger(limits.maxCommentBytes)
        || limits.maxCommentBytes < 0
        || requiredCommands.some(command => !info.commands.includes(command))) {
        throw new Error(`v6emul ${info.emulatorVersion} does not provide memory-edit schema 1`);
    }
}

export function validatePerformanceServer(info: GetServerInfoResponse): void {
    const requiredCommands = [
        IpcCommand.DEBUG_ATTACH,
        IpcCommand.DEBUG_CODE_PERF_ADD,
        IpcCommand.DEBUG_CODE_PERF_DEL_ALL,
        IpcCommand.DEBUG_CODE_PERF_DEL,
        IpcCommand.DEBUG_CODE_PERF_GET,
        IpcCommand.DEBUG_CODE_PERF_EXISTS,
        IpcCommand.DEBUG_CODE_PERF_GET_ALL,
        IpcCommand.DEBUG_CODE_PERF_EDIT,
    ];
    const limits = info.capabilities.codePerfLimits;
    if (info.capabilities.codePerfSchema !== SUPPORTED_CODE_PERF_SCHEMA
        || info.capabilities.codePerfServerAllocatedIds !== true
        || info.capabilities.codePerfEdit !== true
        || info.capabilities.codePerfMutationsWhileRunning !== true
        || !limits
        || !Number.isSafeInteger(limits.addressExclusive)
        || limits.addressExclusive !== 0x10000
        || !Number.isSafeInteger(limits.maxNameBytes)
        || limits.maxNameBytes < 0
        || !Number.isSafeInteger(limits.maxRecords)
        || limits.maxRecords <= 0
        || !Number.isSafeInteger(limits.maxTestCount)
        || limits.maxTestCount <= 0
        || requiredCommands.some(command => !info.commands.includes(command))) {
        throw new Error(`v6emul ${info.emulatorVersion} does not provide CodePerf schema 1`);
    }
}

export function validateTraceLogServer(info: GetServerInfoResponse): void {
    const limits = info.capabilities.traceLogLimits;
    if (info.capabilities.traceLogSchema !== SUPPORTED_TRACE_LOG_SCHEMA
        || info.capabilities.traceLogFilter !== true
        || info.capabilities.traceLogWindowQuery !== true
        || !limits
        || !Number.isSafeInteger(limits.capacity)
        || limits.capacity <= 0
        || !Number.isSafeInteger(limits.maxLines)
        || limits.maxLines <= 0
        || limits.maxLines > limits.capacity
        || !Number.isSafeInteger(limits.maxPatternBytes)
        || limits.maxPatternBytes <= 0
        || !info.commands.includes(IpcCommand.DEBUG_TRACE_LOG_FILTER)
        || !info.commands.includes(IpcCommand.DEBUG_TRACE_LOG_WINDOW)) {
        throw new Error(`v6emul ${info.emulatorVersion} does not provide trace-log schema 1`);
    }
}

export function validateScriptServer(info: GetServerInfoResponse): void {
    const requiredCommands = [
        IpcCommand.DEBUG_SCRIPT_ADD,
        IpcCommand.DEBUG_SCRIPT_DEL_ALL,
        IpcCommand.DEBUG_SCRIPT_DEL,
        IpcCommand.DEBUG_SCRIPT_GET_ALL,
        IpcCommand.DEBUG_SCRIPT_GET_UPDATES,
        IpcCommand.DEBUG_SCRIPT_EDIT,
        IpcCommand.DEBUG_SCRIPT_COMPILE,
        IpcCommand.DEBUG_SCRIPT_RUN_ONCE,
        IpcCommand.DEBUG_SCRIPT_DISABLE,
        IpcCommand.DEBUG_SCRIPT_DISABLE_ALL,
    ];
    const capabilities = info.capabilities;
    const limits = capabilities.scriptLimits;
    if (capabilities.scriptSchema !== SUPPORTED_SCRIPT_SCHEMA
        || capabilities.scriptServerAllocatedIds !== true
        || capabilities.scriptPathSources !== true
        || capabilities.scriptExplicitCompile !== true
        || capabilities.scriptRunOnce !== true
        || capabilities.scriptBulkDisable !== true
        || typeof capabilities.scriptMutationsWhileRunning !== 'boolean'
        || typeof capabilities.scriptRunOnceWhileRunning !== 'boolean'
        || !limits
        || !positiveInteger(limits.maxNameBytes)
        || !positiveInteger(limits.maxPathBytes)
        || !positiveInteger(limits.maxSourceBytes)
        || !positiveInteger(limits.maxRecords)
        || !positiveInteger(limits.maxErrorBytes)
        || !positiveInteger(limits.maxInstructionsPerRun)
        || !positiveInteger(limits.maxExecutionMilliseconds)
        || requiredCommands.some(command => !info.commands.includes(command))) {
        throw new Error(`v6emul ${info.emulatorVersion} does not provide script schema 1`);
    }
}

function positiveInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && (value as number) > 0;
}

export function validateScriptOverlayServer(info: GetServerInfoResponse): void {
    const capabilities = info.capabilities;
    const limits = capabilities.scriptOverlayLimits;
    if (capabilities.scriptOverlaySchema !== SUPPORTED_SCRIPT_OVERLAY_SCHEMA
        || capabilities.scriptOverlayRetained !== true
        || capabilities.scriptOverlayConsumesUpdates !== true
        || capabilities.scriptOverlayVectorScreenCoords !== true
        || capabilities.scriptOverlayColorFormat !== 'RRGGBBAA'
        || !limits
        || !positiveInteger(limits.maxItemsPerScript)
        || !positiveInteger(limits.maxItemsTotal)
        || !positiveInteger(limits.maxTextBytes)
        || !positiveInteger(limits.maxCoordinateMagnitude)
        || !info.commands.includes(IpcCommand.DEBUG_SCRIPT_OVERLAY_GET)) {
        throw new Error(`v6emul ${info.emulatorVersion} does not provide script-overlay schema 1`);
    }
}