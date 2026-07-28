import { expect } from 'chai';
import {
    EmulatorViewModel,
    abgrToRgba,
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

    });

    describe('setRunning', () => {
        it('should return status message with running=true', () => {
            const msg = vm.setRunning(true);
            expect(msg).to.deep.equal({ type: 'status', running: true, speed: '100%', viewMode: 'borderless' });
            expect(vm.running).to.be.true;
        });

        it('should return status message with running=false', () => {
            vm.setRunning(true);
            const msg = vm.setRunning(false);
            expect(msg).to.deep.equal({ type: 'status', running: false, speed: '100%', viewMode: 'borderless' });
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
            }
        });

        it('should reject invalid display mode', () => {
            const ok = vm.setViewMode('invalid');
            expect(ok).to.be.false;
            expect(vm.viewMode).to.equal('borderless'); // unchanged
        });
    });

    describe('processFrame', () => {
        it('should forward the native-cropped RGBA frame unchanged', () => {
            const nativeFrame = new Uint8Array([0xDD, 0xCC, 0xBB, 0xAA]);
            const msg = vm.processFrame(nativeFrame, 512, 256);
            expect(msg.type).to.equal('frame');
            if (msg.type === 'frame') {
                expect(msg.width).to.equal(512);
                expect(msg.height).to.equal(256);
                expect(msg.pixels[0]).to.equal(0xDD);
                expect(msg.pixels[1]).to.equal(0xCC);
                expect(msg.pixels[2]).to.equal(0xBB);
                expect(msg.pixels[3]).to.equal(0xAA);
            }
        });
    });

    describe('makeStatusMessage', () => {
        it('should reflect current state', () => {
            vm.setRunning(true);
            vm.setSpeed('50%');
            const msg = vm.makeStatusMessage();
            expect(msg).to.deep.equal({ type: 'status', running: true, speed: '50%', viewMode: 'borderless' });
        });
    });

    describe('makeErrorMessage', () => {
        it('should produce error message', () => {
            const msg = vm.makeErrorMessage('test error');
            expect(msg).to.deep.equal({ type: 'error', message: 'test error' });
        });
    });
});
