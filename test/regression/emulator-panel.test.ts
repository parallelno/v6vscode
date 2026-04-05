import { expect } from 'chai';
import {
    EmulatorViewModel,
    abgrToRgba,
    cropFrame,
    DISPLAY_MODES,
    FULL_FRAME_WIDTH,
    FULL_FRAME_HEIGHT,
    DisplayMode,
    PanelMessage,
} from '../../src/emulator/panel/emulator-viewmodel';

function makeFullFrame(fillValue: number = 0): Uint8Array {
    const buf = new Uint8Array(FULL_FRAME_WIDTH * FULL_FRAME_HEIGHT * 4);
    buf.fill(fillValue);
    return buf;
}

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
            });
        });

        it('should still process frames after simulated close/reopen cycle', () => {
            const vm = new EmulatorViewModel();
            vm.setRunning(true);
            vm.setViewMode('borderless');

            // Process a frame before "close"
            const frame1 = vm.processFrame(makeFullFrame(0xAA), FULL_FRAME_WIDTH, FULL_FRAME_HEIGHT);
            expect(frame1.type).to.equal('frame');

            // After "reopen" the viewmodel is still intact and can process frames
            const frame2 = vm.processFrame(makeFullFrame(0xBB), FULL_FRAME_WIDTH, FULL_FRAME_HEIGHT);
            expect(frame2.type).to.equal('frame');
            if (frame2.type === 'frame') {
                expect(frame2.width).to.equal(DISPLAY_MODES.borderless.w);
                expect(frame2.height).to.equal(DISPLAY_MODES.borderless.h);
            }
        });
    });

    describe('Display mode switch mid-run', () => {
        it('should produce correctly sized frames when switching modes while running', () => {
            const vm = new EmulatorViewModel();
            vm.setRunning(true);
            const fullFrame = makeFullFrame(0x55);

            const modes: DisplayMode[] = ['borderless', 'border', 'full'];
            for (const mode of modes) {
                vm.setViewMode(mode);
                const msg = vm.processFrame(fullFrame, FULL_FRAME_WIDTH, FULL_FRAME_HEIGHT);
                expect(msg.type).to.equal('frame');
                if (msg.type === 'frame') {
                    const expected = DISPLAY_MODES[mode];
                    expect(msg.width, `${mode} width`).to.equal(expected.w);
                    expect(msg.height, `${mode} height`).to.equal(expected.h);
                    expect(msg.pixels.length, `${mode} pixel count`).to.equal(expected.w * expected.h * 4);
                }
            }
        });

        it('should switch from full to borderless and crop correctly', () => {
            const vm = new EmulatorViewModel();
            vm.setRunning(true);
            vm.setViewMode('full');

            // Create a frame with a known pixel at the borderless origin
            const fullFrame = new Uint8Array(FULL_FRAME_WIDTH * FULL_FRAME_HEIGHT * 4);
            const bless = DISPLAY_MODES.borderless;
            const targetOffset = (bless.y * FULL_FRAME_WIDTH + bless.x) * 4;
            // Set ABGR = [0x11, 0x22, 0x33, 0x44]
            fullFrame[targetOffset]     = 0x11; // A
            fullFrame[targetOffset + 1] = 0x22; // B
            fullFrame[targetOffset + 2] = 0x33; // G
            fullFrame[targetOffset + 3] = 0x44; // R

            // Switch to borderless mid-run
            vm.setViewMode('borderless');
            const msg = vm.processFrame(fullFrame, FULL_FRAME_WIDTH, FULL_FRAME_HEIGHT);
            expect(msg.type).to.equal('frame');
            if (msg.type === 'frame') {
                // First pixel of borderless should be the pixel at (bless.x, bless.y)
                // ABGR [0x11, 0x22, 0x33, 0x44] → RGBA [0x44, 0x33, 0x22, 0x11]
                expect(msg.pixels[0]).to.equal(0x44); // R
                expect(msg.pixels[1]).to.equal(0x33); // G
                expect(msg.pixels[2]).to.equal(0x22); // B
                expect(msg.pixels[3]).to.equal(0x11); // A
            }
        });

        it('should handle rapid mode switching without error', () => {
            const vm = new EmulatorViewModel();
            vm.setRunning(true);
            const fullFrame = makeFullFrame(0);

            // Rapidly switch modes and process frames
            const modes: DisplayMode[] = ['borderless', 'full', 'border', 'borderless', 'full', 'border'];
            for (const mode of modes) {
                vm.setViewMode(mode);
                const msg = vm.processFrame(fullFrame, FULL_FRAME_WIDTH, FULL_FRAME_HEIGHT);
                expect(msg.type).to.equal('frame');
            }
        });

        it('should reject invalid mode and keep previous mode', () => {
            const vm = new EmulatorViewModel();
            vm.setViewMode('border');
            const ok = vm.setViewMode('nonexistent');
            expect(ok).to.be.false;
            expect(vm.viewMode).to.equal('border');
            expect(vm.cropRect).to.deep.equal(DISPLAY_MODES.border);
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

    describe('Crop frame boundary conditions', () => {
        it('should handle 1x1 crop', () => {
            const src = new Uint8Array(16); // 2x2 frame
            src.set([1, 2, 3, 4], 0);       // (0,0)
            src.set([5, 6, 7, 8], 4);       // (1,0)
            src.set([9, 10, 11, 12], 8);    // (0,1)
            src.set([13, 14, 15, 16], 12);  // (1,1)

            const cropped = cropFrame(src, 2, { x: 1, y: 1, w: 1, h: 1 });
            expect(Array.from(cropped)).to.deep.equal([13, 14, 15, 16]);
        });

        it('should handle single-row crop', () => {
            const src = new Uint8Array(4 * 4 * 4); // 4x4
            for (let i = 0; i < src.length; i++) { src[i] = i; }

            const cropped = cropFrame(src, 4, { x: 0, y: 2, w: 4, h: 1 });
            expect(cropped.length).to.equal(4 * 1 * 4);
            // First byte should be first byte of row 2 (offset 2 * 4 * 4 = 32)
            expect(cropped[0]).to.equal(32);
        });

        it('should handle single-column crop', () => {
            const src = new Uint8Array(4 * 3 * 4); // 4x3
            for (let i = 0; i < src.length; i += 4) {
                const px = i / 4;
                src[i] = px;
            }

            const cropped = cropFrame(src, 4, { x: 2, y: 0, w: 1, h: 3 });
            expect(cropped.length).to.equal(1 * 3 * 4);
            // Pixel at (2,0) has index 2, (2,1) has index 6, (2,2) has index 10
            expect(cropped[0]).to.equal(2);
            expect(cropped[4]).to.equal(6);
            expect(cropped[8]).to.equal(10);
        });
    });
});
