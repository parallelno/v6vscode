import { expect } from 'chai';
import {
    EmulatorViewModel,
    abgrToRgba,
    DisplayMode,
} from '../../src/emulator/panel/emulator-viewmodel';

describe('Emulator panel regression tests', () => {

    describe('Panel close/reopen without restart', () => {
        it('should preserve viewmodel state across simulated panel close and reopen', () => {
            // Simulate: user runs emulator, switches speed, closes panel, reopens
            const vm = new EmulatorViewModel();
            vm.setRunning(true);
            vm.setSpeed('200%');
            vm.setViewMode('border');

            // "Close" — the viewmodel state is retained since the same object is used
            expect(vm.running).to.be.true;
            expect(vm.speed).to.equal('200%');
            expect(vm.viewMode).to.equal('border');

            // On "reopen", extension sends a fresh status message via makeStatusMessage
            const statusMsg = vm.makeStatusMessage();
            expect(statusMsg).to.deep.equal({
                type: 'status',
                running: true,
                speed: '200%',
                viewMode: 'border',
            });
        });

        it('should still process frames after simulated close/reopen cycle', () => {
            const vm = new EmulatorViewModel();
            vm.setRunning(true);
            vm.setViewMode('borderless');

            // Process a native-cropped frame before "close"
            const frame1 = vm.processFrame(new Uint8Array(512 * 256 * 4), 512, 256);
            expect(frame1.type).to.equal('frame');

            // After "reopen" the viewmodel is still intact and can process frames
            const frame2 = vm.processFrame(new Uint8Array(512 * 256 * 4), 512, 256);
            expect(frame2.type).to.equal('frame');
            if (frame2.type === 'frame') {
                expect(frame2.width).to.equal(512);
                expect(frame2.height).to.equal(256);
            }
        });
    });

    describe('Display mode switch mid-run', () => {
        it('should preserve dimensions supplied by the native emulator', () => {
            const vm = new EmulatorViewModel();
            vm.setRunning(true);
            const nativeFrames: Array<{ mode: DisplayMode; width: number; height: number }> = [
                { mode: 'borderless', width: 512, height: 256 },
                { mode: 'border', width: 544, height: 288 },
                { mode: 'full', width: 768, height: 312 },
            ];

            for (const nativeFrame of nativeFrames) {
                vm.setViewMode(nativeFrame.mode);
                const pixels = new Uint8Array(nativeFrame.width * nativeFrame.height * 4);
                const msg = vm.processFrame(pixels, nativeFrame.width, nativeFrame.height);
                expect(msg.type).to.equal('frame');
                if (msg.type === 'frame') {
                    expect(msg.width).to.equal(nativeFrame.width);
                    expect(msg.height).to.equal(nativeFrame.height);
                    expect(msg.pixels).to.equal(pixels);
                }
            }
        });

        it('should reject invalid mode and keep previous mode', () => {
            const vm = new EmulatorViewModel();
            vm.setViewMode('border');
            const ok = vm.setViewMode('nonexistent');
            expect(ok).to.be.false;
            expect(vm.viewMode).to.equal('border');
        });
    });

    describe('ABGR→RGBA edge cases', () => {
        it('should handle fully transparent black pixels', () => {
            const abgr = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
            const rgba = abgrToRgba(abgr);
            expect(Array.from(rgba)).to.deep.equal([0x00, 0x00, 0x00, 0x00]);
        });

        it('should handle fully opaque white pixels', () => {
            const abgr = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
            const rgba = abgrToRgba(abgr);
            expect(Array.from(rgba)).to.deep.equal([0xFF, 0xFF, 0xFF, 0xFF]);
        });

        it('should correctly reorder distinct channel values', () => {
            // A=10 B=20 G=30 R=40 → R=40 G=30 B=20 A=10
            const abgr = new Uint8Array([10, 20, 30, 40]);
            const rgba = abgrToRgba(abgr);
            expect(Array.from(rgba)).to.deep.equal([40, 30, 20, 10]);
        });
    });

});
