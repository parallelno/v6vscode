// IPC command identifiers matching the v6emul protocol.
// Negative values are pseudo-commands handled by the IPC server layer.
// Positive values are hardware commands dispatched through Hardware::Request().

export const enum IpcCommand {
    // Pseudo-commands
    PING = -1,
    PONG = -2,
    GET_FRAME = -3,
    GET_FRAME_RAW = -4,
    GET_SERVER_INFO = -5,

    // Emulation control
    RUN = 1,
    STOP = 2,
    IS_RUNNING = 3,
    EXIT = 4,
    RESET = 5,
    RESTART = 6,
    EXECUTE_INSTR = 7,
    EXECUTE_FRAME = 8,
    EXECUTE_FRAME_NO_BREAKS = 9,

    // CPU state
    GET_CC = 10,
    GET_REGS = 11,
    GET_REG_PC = 12,

    // Memory
    GET_BYTE_GLOBAL = 13,
    GET_BYTE_RAM = 14,
    GET_THREE_BYTES_RAM = 15,
    GET_MEM_STRING_GLOBAL = 16,
    GET_WORD_STACK = 17,
    GET_STACK_SAMPLE = 18,
    GET_MEM = 93,
    SET_MEM = 42,
    SET_BYTE_GLOBAL = 43,

    // Display
    GET_DISPLAY_DATA = 19,
    GET_SCROLL_VERT = 27,
    GET_DISPLAY_BORDER_LEFT = 36,
    SET_DISPLAY_BORDER_LEFT = 37,
    GET_DISPLAY_IRQ_COMMIT_PXL = 38,
    SET_DISPLAY_IRQ_COMMIT_PXL = 39,
    SET_FRAME_MODE = 40,
    SET_COLOR_FORMAT = 41,

    // Memory mapping
    GET_MEMORY_MAPPING = 20,
    GET_MEMORY_MAPPINGS = 21,
    GET_GLOBAL_ADDR_RAM = 22,
    IS_MEMROM_ENABLED = 46,

    // FDD / Floppy
    GET_FDC_INFO = 23,
    GET_FDD_INFO = 24,
    GET_FDD_IMAGE = 25,
    LOAD_FDD = 48,
    RESET_UPDATE_FDD = 49,
    MOUNT_FDD = 92,

    // Additional hardware queries
    GET_RUSLAT_HISTORY = 26,
    GET_STEP_OVER_ADDR = 28,
    GET_IO_PORTS = 29,
    GET_IO_PORTS_IN_DATA = 30,
    GET_IO_PORTS_OUT_DATA = 31,
    GET_IO_DISPLAY_MODE = 32,
    GET_IO_PALETTE = 33,
    GET_IO_PALETTE_COMMIT_TIME = 34,
    SET_IO_PALETTE_COMMIT_TIME = 35,
    SET_CPU_SPEED = 44,
    GET_HW_MAIN_STATS = 45,
    KEY_HANDLING = 47,
    RUN_HEADLESS = 50,

    // Debugging
    DEBUG_ATTACH = 51,
    DEBUG_RESET = 52,
    DEBUG_RECORDER_RESET = 53,
    DEBUG_RECORDER_PLAY_FORWARD = 54,
    DEBUG_RECORDER_PLAY_REVERSE = 55,
    DEBUG_RECORDER_GET_STATE_RECORDED = 56,
    DEBUG_RECORDER_GET_STATE_CURRENT = 57,
    DEBUG_RECORDER_SERIALIZE = 58,
    DEBUG_RECORDER_DESERIALIZE = 59,
    DEBUG_BREAKPOINT_ADD = 60,
    DEBUG_BREAKPOINT_DEL = 61,
    DEBUG_BREAKPOINT_DEL_ALL = 62,
    DEBUG_BREAKPOINT_GET_STATUS = 63,
    DEBUG_BREAKPOINT_SET_STATUS = 64,
    DEBUG_BREAKPOINT_ACTIVE = 65,
    DEBUG_BREAKPOINT_DISABLE = 66,
    DEBUG_BREAKPOINT_GET_ALL = 67,
    DEBUG_BREAKPOINT_GET_UPDATES = 68,
    DEBUG_WATCHPOINT_ADD = 69,
    DEBUG_WATCHPOINT_DEL_ALL = 70,
    DEBUG_WATCHPOINT_DEL = 71,
    DEBUG_WATCHPOINT_GET_UPDATES = 72,
    DEBUG_WATCHPOINT_GET_ALL = 73,
    DEBUG_MEMORY_EDIT_ADD = 74,
    DEBUG_MEMORY_EDIT_DEL_ALL = 75,
    DEBUG_MEMORY_EDIT_DEL = 76,
    DEBUG_MEMORY_EDIT_GET = 77,
    DEBUG_MEMORY_EDIT_EXISTS = 78,
    DEBUG_CODE_PERF_ADD = 79,
    DEBUG_CODE_PERF_DEL_ALL = 80,
    DEBUG_CODE_PERF_DEL = 81,
    DEBUG_CODE_PERF_GET = 82,
    DEBUG_CODE_PERF_EXISTS = 83,
    DEBUG_SCRIPT_ADD = 84,
    DEBUG_SCRIPT_DEL_ALL = 85,
    DEBUG_SCRIPT_DEL = 86,
    DEBUG_SCRIPT_GET_ALL = 87,
    DEBUG_SCRIPT_GET_UPDATES = 88,
    DEBUG_TRACE_LOG_ENABLE = 89,
    DEBUG_TRACE_LOG_DISABLE = 90,
    LOAD_ROM = 91,
    DEBUG_WATCHPOINT_EDIT = 94,
    GET_STOP_RECORD = 95,
    GET_HARDWARE_STATS = 96,
    SET_IO_PALETTE_ENTRY = 97,
    DISMOUNT_FDD = 98,
}

// Speed value mapping: user-facing string → IPC integer
export const SPEED_VALUES: Record<string, number> = {
    '1%': 0,
    '20%': 1,
    '50%': 2,
    '100%': 3,
    '200%': 4,
    'max': 5,
};

// --- Typed request interfaces ---

export interface SetCpuSpeedRequest {
    speed: number;
}

export interface LoadRomRequest {
    data: number[];
    addr: number;
    autorun: boolean;
}

export interface MountFddRequest {
    data: number[];
    driveIdx: number;
    path: string;
    autoBoot: boolean;
}

export interface GetFddInfoRequest {
    driveIdx: number;
}

export interface GetFddImageRequest {
    driveIdx: number;
}

export interface ResetUpdateFddRequest {
    driveIdx: number;
}

export interface KeyHandlingRequest {
    scancode: number;
    action: number;
}

// --- Typed response interfaces ---

export interface PingResponse {
    pong: boolean;
}

export interface ServerCapabilities {
    debugger: boolean;
    rawFrame: boolean;
    rawFrameSchema: number;
    stackSampleSchema: number;
    breakpointSchema?: number;
    breakpointLimits?: {
        mappingPageBits: number;
        maxCommentBytes: number;
    };
    watchpointSchema?: number;
    watchpointServerAllocatedIds?: boolean;
    watchpointEdit?: boolean;
    watchpointMutationsWhileRunning?: boolean;
    watchpointLimits?: {
        maxRangeLength: number;
        maxCommentBytes: number;
    };
    stopRecordSchema?: number;
    hardwareStatsSchema?: number;
    hardwareStatsWhileRunning?: boolean;
    paletteEntryMutation?: boolean;
    fddDismount?: boolean;
    runningHardwareMutations?: boolean;
}

export interface GetServerInfoResponse {
    protocolVersion: number;
    emulatorVersion: string;
    commands: number[];
    capabilities: ServerCapabilities;
}

export interface IsRunningResponse {
    isRunning: boolean;
}

export interface ExitResponse {
    exiting: boolean;
}

export interface GetFddInfoResponse {
    path: string;
    updated: boolean;
    reads: number;
    writes: number;
    mounted: boolean;
}

export interface GetFddImageResponse {
    data: number[];
}

export interface GetRegsResponse {
    cc: number;
    pc: number;
    sp: number;
    af: number;
    bc: number;
    de: number;
    hl: number;
    ints: number;
    m: number;
}

export interface GetHardwareMainStatsResponse {
    cc: number;
    rasterLine: number;
    rasterPixel: number;
    frameCc: number;
    frameNum: number;
    displayMode: number;
    scrollVert: number;
    rusLat: boolean;
    inte: boolean;
    iff: boolean;
    hlta: boolean;
    speedPercent: number;
}

export interface FrameRawFrameResponse {
    kind: 'frame';
    width: number;
    height: number;
    pixels: Buffer;
}

export interface FrameRawErrorResponse {
    kind: 'error';
    code: number;
    message: string;
}

export type FrameRawResponse = FrameRawFrameResponse | FrameRawErrorResponse;

// Generic IPC response envelope
export interface IpcResponse<T = unknown> {
    ok: boolean;
    data?: T;
    code?: 'decode_error' | 'invalid_request' | 'unknown_command' | 'dispatch_error' | 'internal_error' | string;
    error?: string;
    details?: {
        command?: number;
        field?: string;
        id?: number;
        [key: string]: unknown;
    };
}
