import { expect } from 'chai';
import { renderScriptOverlays } from '../../../src/emulator/panel/script-overlay-renderer';

const text = {
    scriptId: 1, itemId: 1, vectorScreenCoords: true, x: -1, y: -1,
    color: 0xFFFFFFFF, type: 'text' as const, text: 'corner',
};

describe('renderScriptOverlays', () => {
    it('maps left-bottom active-screen coordinates into the selected crop', () => {
        const borderless = renderScriptOverlays([text], 'borderless');
        expect(borderless[0]).to.include({ x: 511, y: 1, clipX: 0, clipY: 0, clipWidth: 512, clipHeight: 256 });

        const full = renderScriptOverlays([text], 'full');
        expect(full[0]).to.include({ x: 639, y: 41, clipX: 128, clipY: 40, clipWidth: 512, clipHeight: 256 });
    });

    it('uses full-frame coordinates and crops them for border mode', () => {
        const overlays = renderScriptOverlays([{
            scriptId: 2, itemId: 1, vectorScreenCoords: false, x: -1, y: -1,
            color: 0xFFFFFFFF, type: 'rect' as const, width: 3, height: 4, filled: false,
        }], 'border');
        expect(overlays[0]).to.include({ x: 655, y: -27, clipX: 0, clipY: 0, clipWidth: 544, clipHeight: 288 });
    });

    it('uses a rectangle lower-left corner and height when converting y', () => {
        const overlays = renderScriptOverlays([{
            scriptId: 3, itemId: 1, vectorScreenCoords: true, x: 4, y: 0,
            color: 0xFFFFFFFF, type: 'rect' as const, width: 20, height: 10, filled: true,
        }], 'borderless');
        expect(overlays[0]).to.include({ x: 4, y: 246 });
    });
});
