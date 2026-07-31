import { expect } from 'chai';
import { buildHardwareStatisticsNodes } from '../../../src/debug/views/hardware-statistics-view';

describe('Hardware Statistics view', () => {
    it('builds compact register, flag, execution, and display groups', () => {
        const nodes = buildHardwareStatisticsNodes({
            registers: {
                cc: 0x41,
                pc: 0x1234,
                sp: 0x8000,
                af: 0x4100,
                bc: 0x0102,
                de: 0x0304,
                hl: 0x4000,
                ints: 1,
                m: 0x7F,
            },
            hardware: {
                cc: 123,
                rasterLine: 10,
                rasterPixel: 20,
                frameCc: 30,
                frameNum: 40,
                displayMode: 2,
                scrollVert: 5,
                rusLat: false,
                inte: true,
                iff: true,
                hlta: false,
                speedPercent: 100,
            },
        });

        expect(nodes.map(node => node.label)).to.deep.equal([
            'Registers', 'Flags', 'Execution', 'Display',
        ]);
        expect(nodes[0].children).to.deep.include({ label: 'PC', value: '0x1234' });
        expect(nodes[1].children).to.deep.include({ label: 'Z', value: 'Set' });
        expect(nodes[2].children).to.deep.include({ label: 'Speed', value: '100.0%' });
    });
});