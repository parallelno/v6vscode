import { DEFAULT_RUN_SETTINGS, VIEW_MODES, SPEED_VALUES, LOAD_ADDRESS_PATTERN } from '../../shared/emulator-settings';
export interface ValidationError {
    path: string;
    message: string;
}

export type ValidationResult =
    | { ok: true; name: string; run: ValidatedRun }
    | { ok: false; errors: ValidationError[] };

interface ValidatedRun {
    executable: string;
    debugArtifact?: string;
    loadAddr: string;
    fddReadOnly: boolean;
    speed: string;
    viewMode: string;
}

const VALID_VIEW_MODES: readonly string[] = VIEW_MODES;

export function validate(data: unknown): ValidationResult {
    const errors: ValidationError[] = [];

    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return { ok: false, errors: [{ path: '', message: 'Root must be an object.' }] };
    }

    const obj = data as Record<string, unknown>;

    // Check for unknown top-level keys
    const knownTopKeys = new Set(['name', 'run']);
    for (const key of Object.keys(obj)) {
        if (!knownTopKeys.has(key)) {
            errors.push({ path: key, message: `Unknown property "${key}".` });
        }
    }

    // name
    if (!('name' in obj)) {
        errors.push({ path: 'name', message: 'Required property "name" is missing.' });
    } else if (typeof obj.name !== 'string') {
        errors.push({ path: 'name', message: '"name" must be a string.' });
    } else if (obj.name.length === 0) {
        errors.push({ path: 'name', message: '"name" must not be empty.' });
    }

    // run
    if (!('run' in obj)) {
        errors.push({ path: 'run', message: 'Required property "run" is missing.' });
    } else if (typeof obj.run !== 'object' || obj.run === null || Array.isArray(obj.run)) {
        errors.push({ path: 'run', message: '"run" must be an object.' });
    } else {
        const run = obj.run as Record<string, unknown>;
        const knownRunKeys = new Set(['executable', 'debugArtifact', 'loadAddr', 'fddReadOnly', 'speed', 'viewMode']);
        for (const key of Object.keys(run)) {
            if (!knownRunKeys.has(key)) {
                errors.push({ path: `run.${key}`, message: `Unknown property "run.${key}".` });
            }
        }

        if (!('executable' in run)) {
            errors.push({ path: 'run.executable', message: 'Required property "run.executable" is missing.' });
        } else if (typeof run.executable !== 'string') {
            errors.push({ path: 'run.executable', message: '"run.executable" must be a string.' });
        } else if (run.executable.length === 0) {
            errors.push({ path: 'run.executable', message: '"run.executable" must not be empty.' });
        }

        if ('debugArtifact' in run && typeof run.debugArtifact !== 'string') {
            errors.push({ path: 'run.debugArtifact', message: '"run.debugArtifact" must be a string.' });
        } else if (run.debugArtifact === '') {
            errors.push({ path: 'run.debugArtifact', message: '"run.debugArtifact" must not be empty.' });
        }

        if ('loadAddr' in run && typeof run.loadAddr !== 'string') {
            errors.push({ path: 'run.loadAddr', message: '"run.loadAddr" must be a string.' });
        } else if (typeof run.loadAddr === 'string' && !new RegExp(LOAD_ADDRESS_PATTERN).test(run.loadAddr)) {
            errors.push({ path: 'run.loadAddr', message: '"run.loadAddr" must be a complete 16-bit hexadecimal address.' });
        }

        if ('fddReadOnly' in run && typeof run.fddReadOnly !== 'boolean') {
            errors.push({ path: 'run.fddReadOnly', message: '"run.fddReadOnly" must be a boolean.' });
        }

        if ('speed' in run && typeof run.speed !== 'string') {
            errors.push({ path: 'run.speed', message: '"run.speed" must be a string.' });
        } else if (typeof run.speed === 'string' && !Object.prototype.hasOwnProperty.call(SPEED_VALUES, run.speed)) {
            errors.push({ path: 'run.speed', message: '"run.speed" must be a supported emulator speed.' });
        }

        if ('viewMode' in run) {
            if (typeof run.viewMode !== 'string') {
                errors.push({ path: 'run.viewMode', message: '"run.viewMode" must be a string.' });
            } else if (!VALID_VIEW_MODES.includes(run.viewMode)) {
                errors.push({ path: 'run.viewMode', message: `"run.viewMode" must be one of: ${VALID_VIEW_MODES.join(', ')}.` });
            }
        }
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }

    const run = obj.run as Record<string, unknown>;
    return {
        ok: true,
        name: obj.name as string,
        run: {
            executable: run.executable as string,
            debugArtifact: run.debugArtifact as string | undefined,
            loadAddr: typeof run.loadAddr === 'string' ? run.loadAddr : DEFAULT_RUN_SETTINGS.loadAddr,
            fddReadOnly: typeof run.fddReadOnly === 'boolean' ? run.fddReadOnly : DEFAULT_RUN_SETTINGS.fddReadOnly,
            speed: typeof run.speed === 'string' ? run.speed : DEFAULT_RUN_SETTINGS.speed,
            viewMode: typeof run.viewMode === 'string' ? run.viewMode : DEFAULT_RUN_SETTINGS.viewMode,
        },
    };
}
