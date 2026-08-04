import { loadDebugArtifact } from './debug-artifact-loader';
import { DebugIndex, SourceLocation, SymbolInfo } from './debug-index';

export type SymbolResolution =
    | { kind: 'found'; symbol: SymbolInfo }
    | { kind: 'missing' }
    | { kind: 'ambiguous'; candidates: ReadonlyArray<SymbolInfo> };

export interface IndexedSymbol extends SymbolInfo {
    id: string;
}

export class DebugSymbolService {
    private index: DebugIndex | undefined;
    private artifactPath = '';
    private generation = 0;
    private loadGeneration = 0;

    async load(artifactPath: string, executablePath: string): Promise<void> {
        if (!artifactPath) {
            this.clear();
            return;
        }
        if (artifactPath === this.artifactPath && this.index) {
            return;
        }
        const loadGeneration = ++this.loadGeneration;
        const result = await loadDebugArtifact(artifactPath, executablePath);
        if (loadGeneration !== this.loadGeneration) {
            return;
        }
        this.index = result.index;
        this.artifactPath = artifactPath;
        this.generation++;
    }

    clear(): void {
        this.loadGeneration++;
        this.index = undefined;
        this.artifactPath = '';
        this.generation++;
    }

    allSymbols(): ReadonlyArray<IndexedSymbol> {
        return (this.index?.allSymbols() ?? []).map((symbol, index) => ({
            ...symbol,
            id: `${this.generation}:${index}`,
        }));
    }

    symbolById(id: string): IndexedSymbol | undefined {
        return this.allSymbols().find(symbol => symbol.id === id);
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

    requireSymbolAddress(name: string): number {
        const resolution = this.resolveSymbol(name);
        if (resolution.kind === 'missing') { throw new Error(`Symbol not found: ${name}`); }
        if (resolution.kind === 'ambiguous') { throw new Error(`Symbol is ambiguous: ${name}`); }
        return resolution.symbol.address;
    }

    symbolsInRange(start: number, end: number): ReadonlyArray<SymbolInfo> {
        return this.index?.symbolsInRange(start, end) ?? [];
    }

    sourceAtExactAddress(address: number): SourceLocation | undefined {
        return this.index?.resolveAddress(address);
    }

    sourceForSymbol(id: string): SourceLocation | undefined {
        const symbol = this.symbolById(id);
        return symbol?.declaration ?? this.index?.resolveAddress(symbol?.address ?? -1);
    }
}