import type * as vscode from 'vscode';

export interface ProjectScript {
    name: string;
    path: string;
    active: boolean;
    useDebugSymbols?: boolean;
}

export interface V6ProjectRun {
    scripts?: readonly ProjectScript[];
    executable: string;
    debugArtifact?: string;
    loadAddr?: string;
    fddReadOnly?: boolean;
    speed?: string;
    viewMode?: string;
}

export interface V6Project {
    name: string;
    run: V6ProjectRun;
    uri: vscode.Uri;
}
