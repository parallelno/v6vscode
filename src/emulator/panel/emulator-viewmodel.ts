import { SPEED_VALUES } from '../protocol/ipc-commands';

// --- Display mode definitions ---

export type DisplayMode = 'full' | 'border' | 'borderless';

export interface CropRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export const DISPLAY_MODES: Record<DisplayMode, CropRect> = {
    full:       { x: 0,   y: 0,  w: 768, h: 312 },
    border:     { x: 112, y: 24, w: 544, h: 288 },
    borderless: { x: 128, y: 40, w: 512, h: 256 },
};

export const FULL_FRAME_WIDTH = 768;
export const FULL_FRAME_HEIGHT = 312;

// --- ABGR → RGBA conversion ---

/**
 * Convert ABGR pixel buffer to RGBA in-place (or into a new buffer).
 * Each pixel is 4 bytes: [A, B, G, R] → [R, G, B, A].
 */
export function abgrToRgba(abgr: Uint8Array): Uint8Array {
    const rgba = new Uint8Array(abgr.length);
    for (let i = 0; i < abgr.length; i += 4) {
        rgba[i]     = abgr[i + 3]; // R ← byte3
        rgba[i + 1] = abgr[i + 2]; // G ← byte2
        rgba[i + 2] = abgr[i + 1]; // B ← byte1
        rgba[i + 3] = abgr[i];     // A ← byte0
    }
    return rgba;
}

/**
 * Crop a frame buffer to the given rectangle.
 * Input: full frame (srcWidth × srcHeight × 4 bytes per pixel).
 * Output: cropped region (crop.w × crop.h × 4 bytes per pixel).
 */
export function cropFrame(
    src: Uint8Array,
    srcWidth: number,
    crop: CropRect,
): Uint8Array {
    const dst = new Uint8Array(crop.w * crop.h * 4);
    const srcRowBytes = srcWidth * 4;
    const dstRowBytes = crop.w * 4;

    for (let row = 0; row < crop.h; row++) {
        const srcOffset = (crop.y + row) * srcRowBytes + crop.x * 4;
        const dstOffset = row * dstRowBytes;
        dst.set(src.subarray(srcOffset, srcOffset + dstRowBytes), dstOffset);
    }

    return dst;
}

// --- Panel message types ---

export type PanelMessage =
    | { type: 'frame'; width: number; height: number; pixels: number[] }
    | { type: 'status'; running: boolean; speed: string }
    | { type: 'error'; message: string };

export type WebviewMessage =
    | { type: 'run' }
    | { type: 'pause' }
    | { type: 'reset' }
    | { type: 'setSpeed'; value: string }
    | { type: 'setViewMode'; value: string }
    | { type: 'key'; scancode: number; action: number }
    | { type: 'ready' };

// --- View model ---

export class EmulatorViewModel {
    private _running = false;
    private _speed = '100%';
    private _viewMode: DisplayMode = 'borderless';

    get running(): boolean { return this._running; }
    get speed(): string { return this._speed; }
    get viewMode(): DisplayMode { return this._viewMode; }

    get cropRect(): CropRect {
        return DISPLAY_MODES[this._viewMode];
    }

    setRunning(running: boolean): PanelMessage {
        this._running = running;
        return { type: 'status', running: this._running, speed: this._speed };
    }

    setSpeed(speed: string): PanelMessage | null {
        if (SPEED_VALUES[speed] === undefined) {
            return null;
        }
        this._speed = speed;
        return { type: 'status', running: this._running, speed: this._speed };
    }

    setViewMode(mode: string): boolean {
        if (mode !== 'full' && mode !== 'border' && mode !== 'borderless') {
            return false;
        }
        this._viewMode = mode;
        return true;
    }

    /**
     * Process a raw ABGR frame from the emulator.
     * Crops to the current display mode and converts to RGBA.
     * Returns a PanelMessage ready to send to the webview.
     */
    processFrame(abgrPixels: Uint8Array, srcWidth: number, srcHeight: number): PanelMessage {
        const crop = this.cropRect;
        const cropped = cropFrame(abgrPixels, srcWidth, crop);
        const rgba = abgrToRgba(cropped);
        return {
            type: 'frame',
            width: crop.w,
            height: crop.h,
            pixels: Array.from(rgba),
        };
    }

    makeStatusMessage(): PanelMessage {
        return { type: 'status', running: this._running, speed: this._speed };
    }

    makeErrorMessage(message: string): PanelMessage {
        return { type: 'error', message };
    }
}
