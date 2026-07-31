import * as vscode from 'vscode';

export interface V6ProjectRun {
    executable: string;
    debugArtifact?: string;
    bootRom?: string;
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
