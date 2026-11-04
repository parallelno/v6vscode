import * as path from 'path';
import { DirectiveMatch, scanDirectives } from './directive-scan';
import {
    createLookupDependencies,
    DirectiveLookupContext,
    DirectiveLookupDependencies,
    resolveDirectiveOperand,
} from './directive-lookup';

export interface DirectiveAnalysisRequest {
    readonly documentPath: string;
    readonly documentVersion: number;
    readonly text: string;
    readonly workspaceRoots: readonly string[];
}

export interface DirectiveResolution {
    readonly directive: DirectiveMatch;
    /** Resolved file, or undefined when the operand is unresolved. */
    readonly path?: string;
}

/** Analyzes open documents and caches results per document version and roots. */
export class DirectivePathService {
    private readonly dependencies: DirectiveLookupDependencies;
    private readonly cache = new Map<string, Promise<DirectiveResolution[]>>();

    constructor(dependencies: Partial<DirectiveLookupDependencies> = {}) {
        this.dependencies = createLookupDependencies(dependencies);
    }

    analyze(request: DirectiveAnalysisRequest): Promise<DirectiveResolution[]> {
        const key = [request.documentPath, request.documentVersion, ...request.workspaceRoots].join('\u0000');
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }
        const pending = this.analyzeDocument(request);
        this.cache.set(key, pending);
        return pending;
    }

    invalidate(): void {
        this.cache.clear();
    }

    private async analyzeDocument(request: DirectiveAnalysisRequest): Promise<DirectiveResolution[]> {
        const context: DirectiveLookupContext = {
            documentDirectory: path.dirname(request.documentPath),
            workspaceRoots: request.workspaceRoots,
        };
        const byOperand = new Map<string, Promise<string | undefined>>();
        const resolutions: DirectiveResolution[] = [];
        for (const directive of scanDirectives(request.text)) {
            const lookup = byOperand.get(directive.value) ?? this.lookup(directive.value, context);
            byOperand.set(directive.value, lookup);
            const resolved = await lookup;
            resolutions.push(resolved === undefined ? { directive } : { directive, path: resolved });
        }
        return resolutions;
    }

    private async lookup(operand: string, context: DirectiveLookupContext): Promise<string | undefined> {
        const resolution = await resolveDirectiveOperand(operand, context, this.dependencies);
        return resolution.status === 'resolved' ? resolution.path : undefined;
    }
}
