import * as fs from 'fs';
import * as path from 'path';
import { splitSourcePathSegments } from './source-path-segments';

export type PathExists = (candidate: string) => boolean;

/**
 * Relocates a DWARF source path. The fallback need not exist or be absolute.
 *
 * The debug metadata may point at the machine layout where the ROM was built
 * (the "compiled site") rather than the workspace the user is editing. This
 * resolver therefore prefers workspace sources and only falls back to the
 * recorded path:
 *
 *  - drive/UNC paths are first checked against the project root; when they
 *    point elsewhere, they are matched into the workspace by their trailing
 *    path segments (longest match first), so a build-site path such as
 *    `C:/build-site/v6gel/engine/common/v6_consts.asm` opens the workspace
 *    copy `<workspace>/engine/common/v6_consts.asm` when it exists;
 *  - metadata-rooted (`/src/main.asm`) and relative (`src/main.asm`) paths
 *    are resolved against the project root when possible.
 */
export function resolveDebugSourcePath(sourcePath: string, projectRoot: string, exists: PathExists = fs.existsSync): string {
    const normalized = path.normalize(sourcePath);
    const first = sourcePath[0];
    const second = sourcePath[1];
    const isSeparator = (value: string | undefined) => value === '/' || value === path.win32.sep;
    const driveQualified = sourcePath.length >= 3 && sourcePath[1] === ':' && isSeparator(sourcePath[2]);
    const uncPath = isSeparator(first) && isSeparator(second);
    if (driveQualified || uncPath) {
        if (withinProject(normalized, projectRoot)) { return normalized; }
        return findWorkspaceMatch(normalized, projectRoot, exists) ?? normalized;
    }
    const metadataRooted = (first === '/' || first === path.win32.sep)
        && second !== '/'
        && second !== path.win32.sep;
    if (metadataRooted && projectRoot) {
        const projectPath = path.resolve(projectRoot, sourcePath.slice(1));
        return exists(projectPath) || !exists(normalized) ? projectPath : normalized;
    }
    if (projectRoot && !path.isAbsolute(sourcePath)) {
        const projectPath = path.resolve(projectRoot, sourcePath);
        if (exists(projectPath)) { return projectPath; }
    }
    if (exists(normalized) || !projectRoot) {
        return normalized;
    }
    if (!path.isAbsolute(sourcePath)) {
        return path.resolve(projectRoot, sourcePath);
    }
    return normalized;
}

/** True when the path already lives inside the project root. */
function withinProject(candidate: string, projectRoot: string): boolean {
    if (!projectRoot) { return false; }
    const relative = path.relative(projectRoot, candidate);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Locate a workspace copy of a foreign (compiled-site) path by matching its
 * trailing path segments against the project root, longest suffix first.
 * Returns undefined when no workspace file matches.
 */
function findWorkspaceMatch(sourcePath: string, projectRoot: string, exists: PathExists): string | undefined {
    if (!projectRoot) { return undefined; }
    const segments = splitSourcePathSegments(sourcePath);
    for (let count = segments.length; count >= 1; count--) {
        const candidate = path.resolve(projectRoot, ...segments.slice(segments.length - count));
        if (exists(candidate)) { return candidate; }
    }
    return undefined;
}