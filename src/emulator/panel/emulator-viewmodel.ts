import { SPEED_VALUES } from '../protocol/ipc-commands';

// --- Display mode definitions ---

export type DisplayMode = 'full' | 'border' | 'borderless';

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

// --- Panel message types ---

export type PanelMessage =
    | { type: 'frame'; width: number; height: number; pixels: Uint8Array }
    | { type: 'error'; message: string }
    | { type: 'reset' };

export type WebviewMessage =
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

    setRunning(running: boolean): void {
        this._running = running;
    }

    setSpeed(speed: string): boolean {
        if (SPEED_VALUES[speed] === undefined) {
            return false;
        }
        this._speed = speed;
        return true;
    }

    setViewMode(mode: string): boolean {
        if (mode !== 'full' && mode !== 'border' && mode !== 'borderless') {
            return false;
        }
        this._viewMode = mode;
        return true;
    }

    /** Returns the RGBA frame already cropped by the emulator. */
    processFrame(rgbaPixels: Uint8Array, srcWidth: number, srcHeight: number): PanelMessage {
        return {
            type: 'frame',
            width: srcWidth,
            height: srcHeight,
            pixels: rgbaPixels,
        };
    }

    makeErrorMessage(message: string): PanelMessage {
        return { type: 'error', message };
    }

    makeResetMessage(): PanelMessage {
        return { type: 'reset' };
    }
}
