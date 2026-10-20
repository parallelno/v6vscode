import { resolveAgainstDirectory } from '../../platform/files/local-path';

const INCLUDE_REGEX = /\.include\s+"([^"]+)"/g;

export interface IncludeMatch {
    path: string;
    offset: number;
    length: number;
    line: number;
    startChar: number;
}

/** Preserve the existing case-sensitive directive dialect, including comment matches. */
export function findIncludes(text: string): IncludeMatch[] {
    const matches: IncludeMatch[] = [];
    const lines = text.split('\n');

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        const line = lines[lineNum];
        INCLUDE_REGEX.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = INCLUDE_REGEX.exec(line)) !== null) {
            const filePath = m[1];
            const quoteStart = m.index + m[0].indexOf('"') + 1;
            matches.push({
                path: filePath,
                offset: m.index,
                length: m[0].length,
                line: lineNum,
                startChar: quoteStart,
            });
        }
    }

    return matches;
}

/** Include policy: source-directory anchor, no probing or workspace fallback. */
export function resolveIncludePath(sourceDir: string, includePath: string): string {
    return resolveAgainstDirectory(sourceDir, includePath);
}