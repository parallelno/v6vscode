// IPC command identifiers matching the v6emul protocol.
// Negative values are pseudo-commands handled by the IPC server layer.
// Positive values are hardware commands dispatched through Hardware::Request().

export const enum IpcCommand {
    // Pseudo-commands
    PING = -1,
    GET_FRAME = -3,
    GET_FRAME_RAW = -4,

    // Emulation control
    RUN = 1,
    STOP = 2,
    IS_RUNNING = 3,
    EXIT = 4,
    RESET = 5,
    RESTART = 6,
    EXECUTE_INSTR = 7,
    EXECUTE_FRAME_NO_BREAKS = 9,
    SET_CPU_SPEED = 42,

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
    SET_MEM = 40,
    SET_BYTE_GLOBAL = 41,

    // Display
    GET_DISPLAY_DATA = 19,
    GET_SCROLL_VERT = 27,
    GET_DISPLAY_BORDER_LEFT = 36,
    SET_DISPLAY_BORDER_LEFT = 37,
    GET_DISPLAY_IRQ_COMMIT_PXL = 38,
    SET_DISPLAY_IRQ_COMMIT_PXL = 39,

    // I/O & Palette
    GET_IO_PORTS = 29,
    GET_IO_PORTS_IN_DATA = 30,
    GET_IO_PORTS_OUT_DATA = 31,
    GET_IO_DISPLAY_MODE = 32,
    GET_IO_PALETTE = 33,
    GET_IO_PALETTE_COMMIT_TIME = 34,
    SET_IO_PALETTE_COMMIT_TIME = 35,

    // Memory mapping
    GET_MEMORY_MAPPING = 20,
    GET_MEMORY_MAPPINGS = 21,
    GET_GLOBAL_ADDR_RAM = 22,
    IS_MEMROM_ENABLED = 44,

    // Hardware stats
    GET_HW_MAIN_STATS = 43,

    // FDD / Floppy
    GET_FDC_INFO = 23,
    GET_FDD_INFO = 24,
    GET_FDD_IMAGE = 25,
    LOAD_FDD = 46,
    RESET_UPDATE_FDD = 47,
    LOAD_ROM = 89,
    MOUNT_FDD = 90,

    // Keyboard
    KEY_HANDLING = 45,
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

export interface FrameRawResponse {
    width: number;
    height: number;
    pixels: Buffer;
}

// Generic IPC response envelope
export interface IpcResponse<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
}
