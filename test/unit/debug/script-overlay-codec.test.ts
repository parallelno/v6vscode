import { expect } from 'chai';
import { decodeScriptOverlayResponse } from '../../../src/debug/scripts/script-overlay-codec';
import { ScriptOverlayLimits } from '../../../src/emulator/protocol/debug-models';

const limits: ScriptOverlayLimits = {
    maxItemsPerScript: 2,
    maxItemsTotal: 3,
    maxTextBytes: 16,
    maxCoordinateMagnitude: 100,
};

const text = {
    scriptId: 1, itemId: 1, vectorScreenCoords: true, x: 0, y: 0,
    color: 0xFF0000FF, type: 'text', text: 'hello',
};

describe('script overlay codec', () => {
    it('decodes ordered text and rectangle overlays', () => {
        const result = decodeScriptOverlayResponse({
            overlays: [text, {
                scriptId: 1, itemId: 2, vectorScreenCoords: false, x: -1, y: 4,
                color: 0x00FF00FF, type: 'rect', width: 10, height: 12, filled: true,
            }],
        }, limits);
        expect(result.overlays).to.have.length(2);
        expect(result.overlays[1]).to.include({ type: 'rect', filled: true, width: 10, height: 12 });
    });

    it('rejects malformed, out-of-order, and oversized overlay collections', () => {
        expect(() => decodeScriptOverlayResponse({ overlays: [{ ...text, text: 'bad\0text' }] }, limits))
            .to.throw('text must be a non-NUL string');
        expect(() => decodeScriptOverlayResponse({ overlays: [
            { ...text, itemId: 2 }, { ...text, itemId: 1 },
        ] }, limits)).to.throw('ordered by unique scriptId and itemId');
        expect(() => decodeScriptOverlayResponse({ overlays: [text, { ...text, itemId: 2 }, { ...text, itemId: 3 }] }, {
            ...limits, maxItemsPerScript: 1,
        })).to.throw('maxItemsPerScript');
    });
});
