export interface MemoryReadCapabilities {
    maxReadLength: number;
    ramDiskCount: number;
    banksPerRamDisk: number;
    bytesPerBank: number;
    coherentWhileRunning: boolean;
}

export interface ReadMemoryRequest {
    addr: number;
    len: number;
}

export interface ReadMemoryResponse {
    addr: number;
    data: Uint8Array | number[];
}

export interface WriteByteRequest {
    addr: number;
    data: number;
}