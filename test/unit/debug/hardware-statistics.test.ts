import { expect } from 'chai';
import { encode } from '@msgpack/msgpack';
import {
    decodeHardwarePorts,
    decodeHardwareStatistics,
    HardwareStatisticsSnapshot,
} from '../../../src/debug/hardware-statistics/hardware-statistics-model';
import {
    formatMainStatistics,
    formatRamDisk,
    paletteTooltip,
    parseHardwareByte,
    vectorColorRgb24,
} from '../../../src/debug/hardware-statistics/hardware-statistics-format';
import { decodeResponse } from '../../../src/emulator/protocol/ipc-codec';

describe('Hardware statistics model and formatting', () => {
    const response = {
        sessionId: 7,
        uptimeMs: 100 * 3600 * 1000 + 2 * 60 * 1000 + 3000,
        cpuCycles: 370368000,
        lastRunCycles: 19874,
        rasterPixel: 320,
        rasterLine: 120,
        frameCycles: 23120,
        frameNumber: 6543,
        displayMode: 1,
        scrollVertical: 254,
        rusLat: true,
        inte: true,
        iff: false,
        hlta: false,
        palette: Array.from({ length: 16 }, (_, index) => index),
        ramDisk: { index: 0, mapping: 0xF6 },
        fdc: {
            selectedDrive: 0,
            drives: Array.from({ length: 4 }, (_, index) => ({
                mounted: index === 0, path: index === 0 ? 'C:/disk.fdd' : '', updated: false,
            })),
        },
    };

    it('decodes and formats the complete schema', () => {
        const snapshot = decodeHardwareStatistics(response);
        expect(formatMainStatistics(snapshot)).to.deep.equal([
            { label: 'Up Time', value: '100:02:03' },
            { label: 'CPU Cycles', value: '370368000' },
            { label: 'Last Run', value: '19874' },
            { label: 'CRT X/Y', value: '320/120' },
            { label: 'Frame CC', value: '23120' },
            { label: 'Frame Num', value: '6543' },
            { label: 'Display Mode', value: '512' },
            { label: 'Scroll V', value: '0xFE' },
            { label: 'Rus/Lat', value: 'True' },
            { label: 'INTE', value: 'True' },
            { label: 'IFF', value: 'False' },
            { label: 'HLTA', value: 'False' },
        ]);
    });

    it('normalizes the live server Boolean display mode', () => {
        expect(decodeHardwareStatistics({ ...response, displayMode: false }).displayMode).to.equal(0);
        expect(decodeHardwareStatistics({ ...response, displayMode: true }).displayMode).to.equal(1);
    });

    it('rejects malformed atomic snapshots', () => {
        expect(() => decodeHardwareStatistics({ ...response, palette: [1, 2] })).to.throw('16 bytes');
        expect(() => decodeHardwareStatistics({ ...response, scrollVertical: 256 })).to.throw('scrollVertical');
        expect(() => decodeHardwareStatistics({
            ...response, fdc: { ...response.fdc, drives: response.fdc.drives.slice(0, 3) },
        })).to.throw('four entries');
    });

    it('converts Vector colors and formats exact tooltips', () => {
        expect(vectorColorRgb24(0xFF)).to.equal(0xE0E0C0);
        expect(paletteTooltip(15, 0xFF)).to.equal('idx: 15, HW Color: 0xFF, RGB: 0xE0E0C0');
    });

    it('decodes RAM disk mapping bits', () => {
        expect(formatRamDisk(2, 0xF6)).to.deep.equal({
            index: '3', ramMode: '8ACE', ramPage: '2', stackMode: 'On', stackPage: '1',
        });
    });

    it('parses supported clipboard byte forms', () => {
        for (const input of ['255', '0xFF', '$ff', 'FFh']) expect(parseHardwareByte(input)).to.equal(255);
        expect(() => parseHardwareByte('256')).to.throw('0..255');
        expect(() => parseHardwareByte('red')).to.throw('one byte');
    });

    it('requires a lossless 256-byte port payload', () => {
        expect(decodeHardwarePorts({ bytes: Array.from({ length: 256 }, (_, index) => index) }, 'in').bytes[255]).to.equal(255);
        expect(() => decodeHardwarePorts({ data0: 0 }, 'in')).to.throw('exactly 256 bytes');
    });

    it('decodes the server 256-byte MessagePack binary port payload', () => {
        const payload = encode({
            ok: true,
            data: { bytes: Uint8Array.from({ length: 256 }, (_, index) => index) },
        });
        const frame = Buffer.alloc(4 + payload.byteLength);
        frame.writeUInt32LE(payload.byteLength, 0);
        Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).copy(frame, 4);

        const response = decodeResponse(frame);
        const ports = decodeHardwarePorts(response.data, 'out');
        expect(ports.bytes).to.deep.equal(Array.from({ length: 256 }, (_, index) => index));
    });

    it('keeps the decoded object assignable to the public snapshot model', () => {
        const snapshot: HardwareStatisticsSnapshot = decodeHardwareStatistics(response);
        expect(snapshot.fdc.drives).to.have.length(4);
    });
});