import { expect } from 'chai';
import { formatCpuStatistics } from '../../../src/emulator/panel/cpu-statistics-panel';

describe('formatCpuStatistics', () => {
    it('formats registers and decodes the 8080 condition flags', () => {
        const sections = formatCpuStatistics({
            registers: {
                cc: 0xD5,
                pc: 0x1234,
                sp: 0xABCD,
                af: 0xD5A9,
                bc: 0xBEEF,
                de: 0xCAFE,
                hl: 0x0010,
                ints: 3,
                m: 0x7F,
            },
            hardware: {
                cc: 123456,
                rasterLine: 42,
                rasterPixel: 84,
                frameCc: 6000,
                frameNum: 12,
                displayMode: 2,
                scrollVert: 5,
                rusLat: true,
                inte: true,
                iff: false,
                hlta: false,
                speedPercent: 99.95,
            },
        });

        expect(sections[0].rows).to.deep.include.members([
            ['PC', '0x1234'], ['SP', '0xABCD'], ['AF', '0xD5A9'],
            ['Memory at HL', '0x7F'],
        ]);
        expect(sections[1].rows).to.deep.equal([
            ['S', 'Set'], ['Z', 'Set'], ['AC', 'Set'], ['P', 'Set'], ['CY', 'Set'],
        ]);
        expect(sections[2].rows).to.deep.include.members([
            ['Speed', '100.0%'], ['Interrupt enabled', 'Yes'], ['Halted', 'No'],
        ]);
    });
});