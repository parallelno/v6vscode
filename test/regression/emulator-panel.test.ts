import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import {
    EmulatorViewModel,
    abgrToRgba,
    DisplayMode,
} from '../../src/emulator/panel/emulator-viewmodel';

describe('Emulator panel regression tests', () => {

    it('keeps the transparent overlay canvas in both Display templates', () => {
        const root = path.resolve(__dirname, '..', '..');
        const template = fs.readFileSync(path.join(root, 'src/emulator/panel/assets/panel.html'), 'utf8');
        const provider = fs.readFileSync(path.join(root, 'src/emulator/panel/emulator-panel.ts'), 'utf8');
        const script = fs.readFileSync(path.join(root, 'src/emulator/panel/assets/panel.js'), 'utf8');
        const stylesheet = fs.readFileSync(path.join(root, 'src/emulator/panel/assets/panel.css'), 'utf8');
        expect(template).to.include('id="canvas-stack"');
        expect(template).to.include('id="overlays"');
        expect(provider).to.include("'            <canvas id=\"overlays\"></canvas>'");
        expect(script).to.include("case 'overlays':");
        expect(stylesheet).to.include('pointer-events: none');
    });

    it('polls overlays only for a visible compatible Display and retains hidden deltas', () => {
        const root = path.resolve(__dirname, '..', '..');
        const provider = fs.readFileSync(path.join(root, 'src/emulator/panel/emulator-panel.ts'), 'utf8');
        expect(provider).to.include('!this.panel?.visible || !this.lifecycle.connected || !this.overlays.available');
        expect(provider).to.include('this.stopOverlayPolling();');
        expect(provider).to.include('setInterval(() => void this.requestOverlays(), OVERLAY_POLL_INTERVAL_MS)');
        expect(provider).to.include('state.scriptOverlaysHidden');
    });

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

            // Reopening preserves extension-host state even though Display no longer renders controls.
            expect(vm.running).to.equal(true);
            expect(vm.speed).to.equal('200%');
            expect(vm.viewMode).to.equal('border');
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
