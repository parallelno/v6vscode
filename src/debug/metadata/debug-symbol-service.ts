import { loadDebugArtifact } from './debug-artifact-loader';
import { DebugIndex, SourceLocation, SymbolInfo } from './debug-index';

export type SymbolResolution =
    | { kind: 'found'; symbol: SymbolInfo }
    | { kind: 'missing' }
    | { kind: 'ambiguous'; candidates: ReadonlyArray<SymbolInfo> };

export class DebugSymbolService {
    private index: DebugIndex | undefined;
    private artifactPath = '';

    async load(artifactPath: string, executablePath: string): Promise<void> {
        if (!artifactPath) {
            this.clear();
            return;
        }
        if (artifactPath === this.artifactPath && this.index) {
            return;
        }
        const result = await loadDebugArtifact(artifactPath, executablePath);
        this.index = result.index;
        this.artifactPath = artifactPath;
    }

    clear(): void {
        this.index = undefined;
        this.artifactPath = '';
    }

    resolveSymbol(name: string): SymbolResolution {
        const exact = this.index?.symbols(name) ?? [];
        if (exact.length === 1) {
            return { kind: 'found', symbol: exact[0] };
        }
        if (exact.length > 1) {
            return { kind: 'ambiguous', candidates: exact };
        }
        return { kind: 'missing' };
    }

    symbolsInRange(start: number, end: number): ReadonlyArray<SymbolInfo> {
        return this.index?.symbolsInRange(start, end) ?? [];
    }

    sourceAtExactAddress(address: number): SourceLocation | undefined {
        return this.index?.resolveAddress(address);
    }
}