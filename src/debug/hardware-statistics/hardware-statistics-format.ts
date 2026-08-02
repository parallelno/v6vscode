import { HardwareStatisticsSnapshot } from './hardware-statistics-model';

export interface HardwareStatisticsRow {
    label: string;
    value: string;
}

export interface RamDiskDisplay {
    index: string;
    ramMode: string;
    ramPage: string;
    stackMode: string;
    stackPage: string;
}

export function formatMainStatistics(snapshot: HardwareStatisticsSnapshot): HardwareStatisticsRow[] {
    return [
        { label: 'Up Time', value: formatUptime(snapshot.uptimeMs) },
        { label: 'CPU Cycles', value: String(snapshot.cpuCycles) },
        { label: 'Last Run', value: String(snapshot.lastRunCycles) },
        { label: 'CRT X/Y', value: `${snapshot.rasterPixel}/${snapshot.rasterLine}` },
        { label: 'Frame CC', value: String(snapshot.frameCycles) },
        { label: 'Frame Num', value: String(snapshot.frameNumber) },
        { label: 'Display Mode', value: snapshot.displayMode === 0 ? '256' : '512' },
        { label: 'Scroll V', value: hex(snapshot.scrollVertical, 2) },
        { label: 'Rus/Lat', value: bool(snapshot.rusLat) },
        { label: 'INTE', value: bool(snapshot.inte) },
        { label: 'IFF', value: bool(snapshot.iff) },
        { label: 'HLTA', value: bool(snapshot.hlta) },
    ];
}

export function formatRamDisk(index: number, mapping: number): RamDiskDisplay {
    return {
        index: String(index + 1),
        ramMode: `${mapping & 0x40 ? '8' : '-'}${mapping & 0x20 ? 'AC' : '--'}${mapping & 0x80 ? 'E' : '-'}`,
        ramPage: String(mapping & 0x03),
        stackMode: mapping & 0x10 ? 'On' : 'Off',
        stackPage: String((mapping >> 2) & 0x03),
    };
}

export function vectorColorRgb24(hwColor: number): number {
    const red = (hwColor & 0x07) << 5;
    const green = ((hwColor >> 3) & 0x07) << 5;
    const blue = ((hwColor >> 6) & 0x03) << 6;
    return (red << 16) | (green << 8) | blue;
}

export function paletteTooltip(index: number, hwColor: number): string {
    return `idx: ${index}, HW Color: ${hex(hwColor, 2)}, RGB: ${hex(vectorColorRgb24(hwColor), 6)}`;
}

export function parseHardwareByte(input: string): number {
    const value = input.trim();
    let parsed: number;
    if (/^0x[0-9a-f]+$/i.test(value)) parsed = Number.parseInt(value.slice(2), 16);
    else if (/^\$[0-9a-f]+$/i.test(value)) parsed = Number.parseInt(value.slice(1), 16);
    else if (/^[0-9a-f]+h$/i.test(value)) parsed = Number.parseInt(value.slice(0, -1), 16);
    else if (/^[0-9]+$/.test(value)) parsed = Number.parseInt(value, 10);
    else throw new Error('Palette color must be one byte in decimal, 0xNN, $NN, or NNh form');
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xFF) {
        throw new Error('Palette color must be in the range 0..255');
    }
    return parsed;
}

function formatUptime(uptimeMs: number): string {
    const totalSeconds = Math.floor(uptimeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function bool(value: boolean): string { return value ? 'True' : 'False'; }

function hex(value: number, width: number): string {
    return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`;
}