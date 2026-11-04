import * as fs from 'fs';
import * as path from 'path';

/** Injected filesystem access so lookup stays host-free and testable. */
export interface DirectiveLookupDependencies {
    /** True when the candidate names an existing file. */
    fileExists(candidate: string): Promise<boolean>;
    /** Files under `root` whose base filename equals `baseName`. */
    findFilesByBaseName(root: string, baseName: string): Promise<readonly string[]>;
}

export interface DirectiveLookupContext {
    readonly documentDirectory: string;
    /** Workspace roots in VS Code order. */
    readonly workspaceRoots: readonly string[];
}

export type DirectivePathResolution =
    | { readonly status: 'resolved'; readonly path: string }
    | { readonly status: 'unresolved' };

async function fileIsFile(candidate: string): Promise<boolean> {
    try {
        return (await fs.promises.stat(candidate)).isFile();
    } catch {
        return false;
    }
}

export function createLookupDependencies(
    overrides: Partial<DirectiveLookupDependencies> = {},
): DirectiveLookupDependencies {
    return {
        fileExists: overrides.fileExists ?? fileIsFile,
        findFilesByBaseName: overrides.findFilesByBaseName ?? (async () => []),
    };
}

/** Workspace roots with the root containing the document first, then VS Code order. */
export function orderWorkspaceRoots(roots: readonly string[], documentDirectory: string): string[] {
    const documentRoot = roots.find(root => contains(root, documentDirectory));
    return documentRoot === undefined ? [...roots] : [documentRoot, ...roots.filter(root => root !== documentRoot)];
}

/**
 * Resolves a directive operand: an absolute operand as-is, otherwise relative to
 * the document directory and each workspace root. When no exact path exists, the
 * first workspace file with the operand's base filename is used.
 */
export async function resolveDirectiveOperand(
    operand: string,
    context: DirectiveLookupContext,
    dependencies: DirectiveLookupDependencies,
): Promise<DirectivePathResolution> {
    const roots = orderWorkspaceRoots(context.workspaceRoots, context.documentDirectory);
    const exact = path.isAbsolute(operand)
        ? [operand]
        : [path.resolve(context.documentDirectory, operand), ...roots.map(root => path.resolve(root, operand))];
    for (const candidate of exact) {
        if (await dependencies.fileExists(candidate)) {
            return { status: 'resolved', path: candidate };
        }
    }

    const baseName = path.basename(operand);
    for (const root of roots) {
        const found = [...await dependencies.findFilesByBaseName(root, baseName)].sort(comparePaths);
        if (found.length > 0) {
            return { status: 'resolved', path: found[0] };
        }
    }
    return { status: 'unresolved' };
}

function contains(root: string, directory: string): boolean {
    const relative = path.relative(root, directory);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function comparePaths(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}
