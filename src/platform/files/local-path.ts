import * as path from 'path';

/** Host-local lexical resolution. Absolute inputs retain their original spelling. */
export function resolveAgainstDirectory(directory: string, input: string): string {
    return path.isAbsolute(input) ? input : path.resolve(directory, input);
}

/** Local editor-file identity, not a URI, realpath or metadata identity. */
export function localPathKey(file: string): string {
    const normalized = path.normalize(file);
    return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}