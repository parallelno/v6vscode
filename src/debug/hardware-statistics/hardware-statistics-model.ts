export interface HardwareDriveSnapshot {
    mounted: boolean;
    path: string;
    updated: boolean;
}

export interface HardwareStatisticsSnapshot {
    sessionId: number;
    uptimeMs: number;
    cpuCycles: number;
    lastRunCycles: number;
    rasterPixel: number;
    rasterLine: number;
    frameCycles: number;
    frameNumber: number;
    displayMode: 0 | 1;
    scrollVertical: number;
    rusLat: boolean;
    inte: boolean;
    iff: boolean;
    hlta: boolean;
    palette: readonly number[];
    ramDisk: { index: number; mapping: number };
    fdc: { selectedDrive: number; drives: readonly HardwareDriveSnapshot[] };
}

export interface SetPaletteEntryRequest {
    index: number;
    hwColor: number;
}

export interface SetPaletteEntryResponse extends SetPaletteEntryRequest {}

export interface DismountFddRequest {
    driveIdx: number;
}

export interface DismountFddResponse extends DismountFddRequest {
    mounted: false;
}

export function decodeHardwareStatistics(value: unknown): HardwareStatisticsSnapshot {
    const root = object(value, 'hardware statistics');
    const paletteValue = root.palette;
    if (!Array.isArray(paletteValue) || paletteValue.length !== 16) {
        throw new Error('Invalid hardware statistics: palette must contain 16 bytes');
    }
    const palette = paletteValue.map((entry, index) => integer(entry, `palette[${index}]`, 0, 0xFF));
    const ramDisk = object(root.ramDisk, 'ramDisk');
    const fdc = object(root.fdc, 'fdc');
    const drivesValue = fdc.drives;
    if (!Array.isArray(drivesValue) || drivesValue.length !== 4) {
        throw new Error('Invalid hardware statistics: fdc.drives must contain four entries');
    }
    const drives = drivesValue.map((entry, index) => {
        const drive = object(entry, `fdc.drives[${index}]`);
        return {
            mounted: boolean(drive.mounted, `fdc.drives[${index}].mounted`),
            path: string(drive.path, `fdc.drives[${index}].path`, 32768),
            updated: boolean(drive.updated, `fdc.drives[${index}].updated`),
        };
    });
    const rawDisplayMode = root.displayMode;
    const displayMode = rawDisplayMode === false ? 0 : rawDisplayMode === true ? 1
        : integer(rawDisplayMode, 'displayMode', 0, 1) as 0 | 1;

    return {
        sessionId: integer(root.sessionId, 'sessionId'),
        uptimeMs: integer(root.uptimeMs, 'uptimeMs'),
        cpuCycles: integer(root.cpuCycles, 'cpuCycles'),
        lastRunCycles: integer(root.lastRunCycles, 'lastRunCycles'),
        rasterPixel: integer(root.rasterPixel, 'rasterPixel'),
        rasterLine: integer(root.rasterLine, 'rasterLine'),
        frameCycles: integer(root.frameCycles, 'frameCycles'),
        frameNumber: integer(root.frameNumber, 'frameNumber'),
        displayMode,
        scrollVertical: integer(root.scrollVertical, 'scrollVertical', 0, 0xFF),
        rusLat: boolean(root.rusLat, 'rusLat'),
        inte: boolean(root.inte, 'inte'),
        iff: boolean(root.iff, 'iff'),
        hlta: boolean(root.hlta, 'hlta'),
        palette,
        ramDisk: {
            index: integer(ramDisk.index, 'ramDisk.index', 0, 7),
            mapping: integer(ramDisk.mapping, 'ramDisk.mapping', 0, 0xFF),
        },
        fdc: {
            selectedDrive: integer(fdc.selectedDrive, 'fdc.selectedDrive', 0, 3),
            drives,
        },
    };
}

function object(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Invalid hardware statistics: ${name} must be an object`);
    }
    return value as Record<string, unknown>;
}

function integer(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
    if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
        throw new Error(`Invalid hardware statistics: ${name} must be an integer in ${min}..${max}`);
    }
    return value as number;
}

function boolean(value: unknown, name: string): boolean {
    if (typeof value !== 'boolean') {
        throw new Error(`Invalid hardware statistics: ${name} must be a boolean`);
    }
    return value;
}

function string(value: unknown, name: string, maxLength: number): string {
    if (typeof value !== 'string' || value.length > maxLength) {
        throw new Error(`Invalid hardware statistics: ${name} must be a string`);
    }
    return value;
}