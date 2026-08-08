import { SourceLocation } from '../debug/metadata/debug-index';
import { AssemblyHighlighter, HighlightSpan } from './assembly-highlighter';
import { SourceLineService } from './source-line-service';
import {
    SourceDocumentContext,
    SourceSymbolLinkService,
    SymbolLink,
} from './symbols/symbol-link-service';

export interface PresentedLine {
    text: string;
    highlights: readonly HighlightSpan[];
    links: readonly SymbolLink[];
}

export interface LanguagePresentationService {
    presentSourceLine(
        location: SourceLocation,
        context: SourceDocumentContext,
    ): Promise<PresentedLine | undefined>;
    presentStandaloneLine(text: string): PresentedLine;
}

export class DefaultLanguagePresentationService implements LanguagePresentationService {
    constructor(
        private readonly sourceLines: SourceLineService,
        private readonly highlighter: AssemblyHighlighter,
        private readonly symbolLinks: SourceSymbolLinkService,
    ) {}

    async presentSourceLine(
        location: SourceLocation,
        context: SourceDocumentContext,
    ): Promise<PresentedLine | undefined> {
        const sourceLine = await this.sourceLines.read(location, context.projectRoot);
        if (!sourceLine) { return undefined; }
        return {
            text: sourceLine.text,
            highlights: this.highlighter.tokenizeLine(sourceLine.text),
            links: await this.symbolLinks.links(sourceLine.text, context),
        };
    }

    presentStandaloneLine(text: string): PresentedLine {
        return {
            text,
            highlights: this.highlighter.tokenizeLine(text),
            links: [],
        };
    }
}