import { ArtifactRepository, ArtifactHandle, artifactRepository } from './artifact-repository';
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
    private handle: ArtifactHandle | undefined;
    private generation = 0;
    private loadGeneration = 0;
    private projectSubscription: { dispose(): void } | undefined;

    constructor(private readonly repository: ArtifactRepository = artifactRepository) {}

    fork(): DebugSymbolService { return new DebugSymbolService(this.repository); }
    get artifactVersion(): string | undefined { return this.handle?.version; }
    get snapshot(): ArtifactHandle | undefined { return this.handle; }

    /** Each consumer follows project selection independently; clearing it never clears the repository. */
    followProject(projects: {
        onDidChange(listener: (project: { run: { debugArtifact?: string; executable: string } } | undefined) => void): { dispose(): void };
    }): this {
        this.projectSubscription?.dispose();
        this.projectSubscription = projects.onDidChange(project => {
            this.clear();
            if (project?.run.debugArtifact) {
                void this.load(project.run.debugArtifact, project.run.executable).catch(() => { /* Consumer reports loading errors. */ });
            }
        });
        return this;
    }

    dispose(): void { this.projectSubscription?.dispose(); this.projectSubscription = undefined; this.clear(); }

    async load(artifactPath: string, executablePath: string, force = false): Promise<void> {
        if (!artifactPath) {
            this.clear();
            return;
        }
        const loadGeneration = ++this.loadGeneration;
        let result: ArtifactHandle;
        try { result = await this.repository.load(artifactPath, executablePath, force); }
        catch (error) {
            if (loadGeneration !== this.loadGeneration) { return; }
            throw error;
        }
        if (loadGeneration !== this.loadGeneration) {
            return;
        }
        this.index = result.index;
        if (this.handle?.version !== result.version) { this.generation++; }
        this.handle = result;
    }

    clear(): void {
        this.loadGeneration++;
        this.index = undefined;
        this.handle = undefined;
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

    sourceFiles(): ReadonlyArray<string> {
        return this.index?.sourceFiles ?? [];
    }

    sourceAtExactAddress(address: number): SourceLocation | undefined {
        return this.index?.resolveAddress(address);
    }

    sourceForSymbol(id: string): SourceLocation | undefined {
        const symbol = this.symbolById(id);
        return symbol?.declaration ?? this.index?.resolveAddress(symbol?.address ?? -1);
    }
}