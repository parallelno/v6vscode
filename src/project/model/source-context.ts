import * as path from 'path';

/** The selected project file owns its source anchor; callers supply any workspace fallback. */
export function projectSourceRoot(project: { readonly uri: { readonly fsPath: string } } | undefined, fallback = ''): string {
    return project ? path.dirname(project.uri.fsPath) : fallback;
}