import { ScriptOverlayItem } from '../../emulator/protocol/debug-models';
import { DisplayMode } from './emulator-viewmodel';

export type RenderedScriptOverlay = ScriptOverlayItem & {
    x: number;
    y: number;
    clipX: number;
    clipY: number;
    clipWidth: number;
    clipHeight: number;
};

interface Crop { x: number; y: number; width: number; height: number; }

const FRAME: Crop = { x: 0, y: 0, width: 768, height: 312 };
const ACTIVE_SCREEN: Crop = { x: 128, y: 40, width: 512, height: 256 };
const CROPS: Record<DisplayMode, Crop> = {
    full: FRAME,
    border: { x: 112, y: 24, width: 544, height: 288 },
    borderless: ACTIVE_SCREEN,
};

export function renderScriptOverlays(
    overlays: readonly ScriptOverlayItem[], mode: DisplayMode,
): readonly RenderedScriptOverlay[] {
    const crop = CROPS[mode];
    return overlays.map(overlay => {
        const source = overlay.vectorScreenCoords ? ACTIVE_SCREEN : FRAME;
        const sourceX = overlay.x < 0 ? source.width + overlay.x : overlay.x;
        const sourceY = overlay.y < 0 ? source.height + overlay.y : overlay.y;
        const originX = overlay.vectorScreenCoords ? ACTIVE_SCREEN.x : 0;
        const originY = overlay.vectorScreenCoords
            ? FRAME.height - ACTIVE_SCREEN.y - ACTIVE_SCREEN.height
            : 0;
        const clip = intersection(overlay.vectorScreenCoords ? ACTIVE_SCREEN : FRAME, crop);
        const itemHeight = overlay.type === 'rect' ? overlay.height : 0;
        return {
            ...overlay,
            x: originX + sourceX - crop.x,
            y: FRAME.height - originY - sourceY - itemHeight - crop.y,
            clipX: clip.x - crop.x,
            clipY: clip.y - crop.y,
            clipWidth: clip.width,
            clipHeight: clip.height,
        };
    }).filter(overlay => overlay.clipWidth > 0 && overlay.clipHeight > 0);
}

function intersection(left: Crop, right: Crop): Crop {
    const x = Math.max(left.x, right.x);
    const y = Math.max(left.y, right.y);
    const rightEdge = Math.min(left.x + left.width, right.x + right.width);
    const bottomEdge = Math.min(left.y + left.height, right.y + right.height);
    return { x, y, width: Math.max(0, rightEdge - x), height: Math.max(0, bottomEdge - y) };
}
