import * as fs from 'fs';
import * as path from 'path';

export function resolveDebugSourcePath(sourcePath: string, projectRoot: string): string {
    const normalized = path.normalize(sourcePath);
    const first = sourcePath[0];
    const second = sourcePath[1];
    const isSeparator = (value: string | undefined) => value === '/' || value === path.win32.sep;
    const driveQualified = sourcePath.length >= 3 && sourcePath[1] === ':' && isSeparator(sourcePath[2]);
    const uncPath = isSeparator(first) && isSeparator(second);
    if (driveQualified || uncPath) {
        return normalized;
    }
    const metadataRooted = (first === '/' || first === path.win32.sep)
        && second !== '/'
        && second !== path.win32.sep;
    if (metadataRooted && projectRoot) {
        const projectPath = path.resolve(projectRoot, sourcePath.slice(1));
        return fs.existsSync(projectPath) || !fs.existsSync(normalized) ? projectPath : normalized;
    }
    if (fs.existsSync(normalized) || !projectRoot) {
        return normalized;
    }
    if (!path.isAbsolute(sourcePath)) {
        return path.resolve(projectRoot, sourcePath);
    }
    return normalized;
}