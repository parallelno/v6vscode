import type { V6ProjectRun } from './v6-project';
import { DEFAULT_RUN_SETTINGS, SPEED_VALUES, frameMode, loadAddress, ViewMode } from '../../shared/emulator-settings';

export interface NormalizedRun extends V6ProjectRun {
    readonly executable: string;
    readonly loadAddr: string;
    readonly loadAddress: number;
    readonly fddReadOnly: boolean;
    readonly speed: string;
    readonly viewMode: ViewMode;
}

/** Shared defaults for Run, Debug, settings and persisted project projections. */
export function normalizeRun(run: V6ProjectRun): NormalizedRun {
    return Object.freeze({ ...run,
        loadAddr: run.loadAddr ?? DEFAULT_RUN_SETTINGS.loadAddr,
        loadAddress: loadAddress(run.loadAddr), fddReadOnly: run.fddReadOnly ?? DEFAULT_RUN_SETTINGS.fddReadOnly,
        speed: !Object.prototype.hasOwnProperty.call(SPEED_VALUES, run.speed ?? '') ? DEFAULT_RUN_SETTINGS.speed : run.speed!,
        viewMode: frameMode(run.viewMode).panelMode,
    });
}