import * as vscode from 'vscode';
import { DebugSymbolService } from '../debug/metadata/debug-symbol-service';
import { AssemblyHighlighter, createAssemblyHighlighter } from './assembly-highlighter';
import {
    DefaultLanguagePresentationService,
    LanguagePresentationService,
} from './language-presentation-service';
import { SourceLineService, VsCodeSourceLineService } from './source-line-service';
import {
    DebugSourceSymbolLinkService,
    SourceSymbolLinkService,
} from './symbols/symbol-link-service';

export interface LanguageServices extends vscode.Disposable {
    readonly sourceLines: SourceLineService;
    readonly highlighter: AssemblyHighlighter;
    readonly symbolLinks: SourceSymbolLinkService;
    readonly presentation: LanguagePresentationService;
}

export async function createLanguageServices(
    extensionRoot: string,
    symbols: DebugSymbolService,
): Promise<LanguageServices> {
    const sourceLines = new VsCodeSourceLineService();
    const highlighter = await createAssemblyHighlighter(extensionRoot);
    const symbolLinks = new DebugSourceSymbolLinkService(symbols, async sourcePath => {
        try {
            return (await vscode.workspace.openTextDocument(vscode.Uri.file(sourcePath))).getText();
        } catch {
            return undefined;
        }
    });
    const presentation = new DefaultLanguagePresentationService(
        sourceLines,
        highlighter,
        symbolLinks,
    );
    return {
        sourceLines,
        highlighter,
        symbolLinks,
        presentation,
        dispose: () => {
            sourceLines.dispose();
            if ('clear' in highlighter && typeof highlighter.clear === 'function') {
                highlighter.clear();
            }
        },
    };
}

export * from './assembly-highlighter';
export * from './language-presentation-service';
export * from './source-line-service';
export * from './symbols/symbol-link-service';