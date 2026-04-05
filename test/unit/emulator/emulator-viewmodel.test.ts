import { expect } from 'chai';
import {
    EmulatorViewModel,
    abgrToRgba,
    cropFrame,
    DISPLAY_MODES,
    FULL_FRAME_WIDTH,
    FULL_FRAME_HEIGHT,
    DisplayMode,
} from '../../../src/emulator/panel/emulator-viewmodel';

describe('abgrToRgba', () => {
    it('should convert a single ABGR pixel to RGBA', () => {
        // [A, B, G, R] → [R, G, B, A]
        const abgr = new Uint8Array([0xAA, 0xBB, 0xCC, 0xDD]);
        const rgba = abgrToRgba(abgr);
        expect(Array.from(rgba)).to.deep.equal([0xDD, 0xCC, 0xBB, 0xAA]);
    });

    it('should convert multiple pixels', () => {
        const abgr = new Uint8Array([
            0xFF, 0x00, 0x00, 0x00, // pixel 0: A=FF B=00 G=00 R=00
            0x00, 0xFF, 0x00, 0x00, // pixel 1: A=00 B=FF G=00 R=00
        ]);
        const rgba = abgrToRgba(abgr);
        expect(Array.from(rgba)).to.deep.equal([
            0x00, 0x00, 0x00, 0xFF, // pixel 0: R=00 G=00 B=00 A=FF
            0x00, 0x00, 0xFF, 0x00, // pixel 1: R=00 G=00 B=FF A=00
        ]);
    });

    it('should handle empty input', () => {
        const rgba = abgrToRgba(new Uint8Array(0));
        expect(rgba.length).to.equal(0);
    });

    it('should produce output of same length', () => {
        const abgr = new Uint8Array(4 * 100);
        const rgba = abgrToRgba(abgr);
        expect(rgba.length).to.equal(abgr.length);
    });
});

describe('cropFrame', () => {
    function makeTestFrame(width: number, height: number): Uint8Array {
        const buf = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const offset = (y * width + x) * 4;
                buf[offset] = x & 0xFF;     // channel 0 = x
                buf[offset + 1] = y & 0xFF; // channel 1 = y
                buf[offset + 2] = 0;
                buf[offset + 3] = 0xFF;
            }
        }
        return buf;
    }

    it('should crop a region from the frame', () => {
        const src = makeTestFrame(8, 8);
        const cropped = cropFrame(src, 8, { x: 2, y: 3, w: 3, h: 2 });
        expect(cropped.length).to.equal(3 * 2 * 4);

        // First pixel should be at (2, 3)
        expect(cropped[0]).to.equal(2);  // x=2
        expect(cropped[1]).to.equal(3);  // y=3

        // Second pixel in first row should be at (3, 3)
        expect(cropped[4]).to.equal(3);  // x=3
        expect(cropped[5]).to.equal(3);  // y=3

        // First pixel of second row should be at (2, 4)
        const row2offset = 3 * 4;
        expect(cropped[row2offset]).to.equal(2);     // x=2
        expect(cropped[row2offset + 1]).to.equal(4); // y=4
    });

    it('should produce correct output dimensions for each display mode', () => {
        const src = new Uint8Array(FULL_FRAME_WIDTH * FULL_FRAME_HEIGHT * 4);
        for (const [mode, rect] of Object.entries(DISPLAY_MODES)) {
            const cropped = cropFrame(src, FULL_FRAME_WIDTH, rect);
            expect(cropped.length, `${mode} pixel count`).to.equal(rect.w * rect.h * 4);
        }
    });

    it('should handle full-frame crop (no-op)', () => {
        const src = new Uint8Array(4 * 4 * 4); // 4x4
        src.fill(42);
        const cropped = cropFrame(src, 4, { x: 0, y: 0, w: 4, h: 4 });
        expect(Array.from(cropped)).to.deep.equal(Array.from(src));
    });
});

describe('DISPLAY_MODES', () => {
    it('should define three modes', () => {
        expect(Object.keys(DISPLAY_MODES)).to.have.length(3);
    });

    it('full mode should cover entire frame', () => {
        const full = DISPLAY_MODES.full;
        expect(full.x).to.equal(0);
        expect(full.y).to.equal(0);
        expect(full.w).to.equal(768);
        expect(full.h).to.equal(312);
    });

    it('border mode should be smaller than full', () => {
        const border = DISPLAY_MODES.border;
        expect(border.w).to.be.lessThan(DISPLAY_MODES.full.w);
        expect(border.h).to.be.lessThan(DISPLAY_MODES.full.h);
        expect(border.x + border.w).to.be.at.most(FULL_FRAME_WIDTH);
        expect(border.y + border.h).to.be.at.most(FULL_FRAME_HEIGHT);
    });

    it('borderless mode should be the smallest', () => {
        const borderless = DISPLAY_MODES.borderless;
        expect(borderless.w).to.be.lessThan(DISPLAY_MODES.border.w);
        expect(borderless.h).to.be.lessThan(DISPLAY_MODES.border.h);
        expect(borderless.x + borderless.w).to.be.at.most(FULL_FRAME_WIDTH);
        expect(borderless.y + borderless.h).to.be.at.most(FULL_FRAME_HEIGHT);
    });

    it('all crop rects should stay within full frame bounds', () => {
        for (const [mode, rect] of Object.entries(DISPLAY_MODES)) {
            expect(rect.x >= 0, `${mode} x >= 0`).to.be.true;
            expect(rect.y >= 0, `${mode} y >= 0`).to.be.true;
            expect(rect.x + rect.w <= FULL_FRAME_WIDTH, `${mode} x+w <= width`).to.be.true;
            expect(rect.y + rect.h <= FULL_FRAME_HEIGHT, `${mode} y+h <= height`).to.be.true;
        }
    });
});

describe('EmulatorViewModel', () => {
    let vm: EmulatorViewModel;

    beforeEach(() => {
        vm = new EmulatorViewModel();
    });

    describe('initial state', () => {
        it('should start as not running', () => {
            expect(vm.running).to.be.false;
        });

        it('should default speed to 100%', () => {
            expect(vm.speed).to.equal('100%');
        });

        it('should default view mode to borderless', () => {
            expect(vm.viewMode).to.equal('borderless');
        });

        it('should have borderless crop rect by default', () => {
            expect(vm.cropRect).to.deep.equal(DISPLAY_MODES.borderless);
        });
    });

    describe('setRunning', () => {
        it('should return status message with running=true', () => {
            const msg = vm.setRunning(true);
            expect(msg).to.deep.equal({ type: 'status', running: true, speed: '100%' });
            expect(vm.running).to.be.true;
        });

        it('should return status message with running=false', () => {
            vm.setRunning(true);
            const msg = vm.setRunning(false);
            expect(msg).to.deep.equal({ type: 'status', running: false, speed: '100%' });
            expect(vm.running).to.be.false;
        });
    });

    describe('setSpeed', () => {
        it('should accept valid speed values', () => {
            for (const speed of ['1%', '20%', '50%', '100%', '200%', 'max']) {
                const msg = vm.setSpeed(speed);
                expect(msg, `speed ${speed}`).to.not.be.null;
                expect(msg!.type).to.equal('status');
                expect(vm.speed).to.equal(speed);
            }
        });

        it('should return null for invalid speed', () => {
            const msg = vm.setSpeed('invalid');
            expect(msg).to.be.null;
            expect(vm.speed).to.equal('100%'); // unchanged
        });
    });

    describe('setViewMode', () => {
        it('should accept valid display modes', () => {
            const modes: DisplayMode[] = ['full', 'border', 'borderless'];
            for (const mode of modes) {
                const ok = vm.setViewMode(mode);
                expect(ok, `mode ${mode}`).to.be.true;
                expect(vm.viewMode).to.equal(mode);
                expect(vm.cropRect).to.deep.equal(DISPLAY_MODES[mode]);
            }
        });

        it('should reject invalid display mode', () => {
            const ok = vm.setViewMode('invalid');
            expect(ok).to.be.false;
            expect(vm.viewMode).to.equal('borderless'); // unchanged
        });
    });

    describe('processFrame', () => {
        it('should crop and convert ABGR to RGBA', () => {
            // Create a minimal 4x2 frame with known ABGR pixels
            const w = 4;
            const h = 2;
            const abgr = new Uint8Array(w * h * 4);
            // pixel (0,0): ABGR = [10, 20, 30, 40]
            abgr.set([10, 20, 30, 40], 0);

            vm.setViewMode('full');
            // Override the crop rect to match our small frame
            // Since we can't override DISPLAY_MODES, just test with full frame bounds
            // by using a frame that matches full dimensions
            const fullW = FULL_FRAME_WIDTH;
            const fullH = FULL_FRAME_HEIGHT;
            const fullFrame = new Uint8Array(fullW * fullH * 4);
            // Set pixel at (0,0): ABGR = [0xAA, 0xBB, 0xCC, 0xDD]
            fullFrame.set([0xAA, 0xBB, 0xCC, 0xDD], 0);

            const msg = vm.processFrame(fullFrame, fullW, fullH);
            expect(msg.type).to.equal('frame');
            if (msg.type === 'frame') {
                expect(msg.width).to.equal(DISPLAY_MODES.full.w);
                expect(msg.height).to.equal(DISPLAY_MODES.full.h);
                // First pixel should be [R, G, B, A] = [0xDD, 0xCC, 0xBB, 0xAA]
                expect(msg.pixels[0]).to.equal(0xDD);
                expect(msg.pixels[1]).to.equal(0xCC);
                expect(msg.pixels[2]).to.equal(0xBB);
                expect(msg.pixels[3]).to.equal(0xAA);
            }
        });

        it('should use current view mode crop rect', () => {
            vm.setViewMode('borderless');
            const fullFrame = new Uint8Array(FULL_FRAME_WIDTH * FULL_FRAME_HEIGHT * 4);
            const msg = vm.processFrame(fullFrame, FULL_FRAME_WIDTH, FULL_FRAME_HEIGHT);
            if (msg.type === 'frame') {
                expect(msg.width).to.equal(512);
                expect(msg.height).to.equal(256);
            }
        });
    });

    describe('makeStatusMessage', () => {
        it('should reflect current state', () => {
            vm.setRunning(true);
            vm.setSpeed('50%');
            const msg = vm.makeStatusMessage();
            expect(msg).to.deep.equal({ type: 'status', running: true, speed: '50%' });
        });
    });

    describe('makeErrorMessage', () => {
        it('should produce error message', () => {
            const msg = vm.makeErrorMessage('test error');
            expect(msg).to.deep.equal({ type: 'error', message: 'test error' });
        });
    });
});
