export interface ValidationError {
    path: string;
    message: string;
}

export type ValidationResult =
    | { ok: true; name: string; run: ValidatedRun }
    | { ok: false; errors: ValidationError[] };

interface ValidatedRun {
    executable: string;
    bootRom?: string;
    loadAddr: string;
    fddReadOnly: boolean;
    speed: string;
    viewMode: string;
}

const VALID_VIEW_MODES = ['borderless', 'bordered', 'full'];

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
        const knownRunKeys = new Set(['executable', 'bootRom', 'loadAddr', 'fddReadOnly', 'speed', 'viewMode']);
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

        if ('bootRom' in run && typeof run.bootRom !== 'string') {
            errors.push({ path: 'run.bootRom', message: '"run.bootRom" must be a string.' });
        }

        if ('loadAddr' in run && typeof run.loadAddr !== 'string') {
            errors.push({ path: 'run.loadAddr', message: '"run.loadAddr" must be a string.' });
        }

        if ('fddReadOnly' in run && typeof run.fddReadOnly !== 'boolean') {
            errors.push({ path: 'run.fddReadOnly', message: '"run.fddReadOnly" must be a boolean.' });
        }

        if ('speed' in run && typeof run.speed !== 'string') {
            errors.push({ path: 'run.speed', message: '"run.speed" must be a string.' });
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
            bootRom: run.bootRom as string | undefined,
            loadAddr: typeof run.loadAddr === 'string' ? run.loadAddr : '0x100',
            fddReadOnly: typeof run.fddReadOnly === 'boolean' ? run.fddReadOnly : false,
            speed: typeof run.speed === 'string' ? run.speed : '100%',
            viewMode: typeof run.viewMode === 'string' ? run.viewMode : 'borderless',
        },
    };
}
