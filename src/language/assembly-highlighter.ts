import { promises as fs } from 'fs';
import * as path from 'path';
import { loadWASM, OnigScanner, OnigString } from 'vscode-oniguruma';
import {
    IGrammar,
    IOnigLib,
    INITIAL,
    parseRawGrammar,
    Registry,
    StateStack,
} from 'vscode-textmate';

const ASSEMBLY_SCOPE = 'source.v6vscode_8080';
const DEFAULT_LINE_CACHE_SIZE = 256;
const DEFAULT_DOCUMENT_CACHE_SIZE = 32;

export type AssemblyTokenClass =
    | 'plain'
    | 'comment'
    | 'line-comment'
    | 'string'
    | 'global-label'
    | 'local-label'
    | 'constant'
    | 'macro'
    | 'directive'
    | 'keyword'
    | 'control'
    | 'instruction'
    | 'register'
    | 'number'
    | 'operator';

export interface HighlightSpan {
    start: number;
    length: number;
    tokenClass: AssemblyTokenClass;
}

export interface AssemblyHighlighter {
    tokenizeLine(text: string): readonly HighlightSpan[];
    tokenizeDocument(text: string): readonly (readonly HighlightSpan[])[];
}

let sharedGrammar: Promise<IGrammar> | undefined;

export async function createAssemblyHighlighter(
    extensionRoot: string,
    lineCacheSize = DEFAULT_LINE_CACHE_SIZE,
    documentCacheSize = DEFAULT_DOCUMENT_CACHE_SIZE,
): Promise<TextMateAssemblyHighlighter> {
    sharedGrammar ??= loadGrammar(extensionRoot);
    return new TextMateAssemblyHighlighter(
        await sharedGrammar,
        lineCacheSize,
        documentCacheSize,
    );
}

export class TextMateAssemblyHighlighter implements AssemblyHighlighter {
    private readonly lineCache = new Map<string, readonly HighlightSpan[]>();
    private readonly documentCache = new Map<string, readonly (readonly HighlightSpan[])[]>();

    constructor(
        private readonly grammar: IGrammar,
        private readonly lineCacheSize = DEFAULT_LINE_CACHE_SIZE,
        private readonly documentCacheSize = DEFAULT_DOCUMENT_CACHE_SIZE,
    ) {}

    tokenizeLine(text: string): readonly HighlightSpan[] {
        const cached = getLru(this.lineCache, text);
        if (cached) { return cached; }
        const spans = this.tokenize(text, INITIAL).spans;
        setLru(this.lineCache, text, spans, this.lineCacheSize);
        return spans;
    }

    tokenizeDocument(text: string): readonly (readonly HighlightSpan[])[] {
        return this.tokenizeSourceDocument(text, 'text', text);
    }

    tokenizeSourceDocument(
        sourceId: string,
        version: string,
        text: string,
    ): readonly (readonly HighlightSpan[])[] {
        const key = `${normalizeSourceId(sourceId)}\0${version}`;
        const cached = getLru(this.documentCache, key);
        if (cached) { return cached; }

        let ruleStack: StateStack | null = INITIAL;
        const result = text.split(/\r?\n/).map(line => {
            const tokenized = this.tokenize(line, ruleStack);
            ruleStack = tokenized.ruleStack;
            return tokenized.spans;
        });
        setLru(this.documentCache, key, result, this.documentCacheSize);
        return result;
    }

    cacheSizes(): { lines: number; documents: number } {
        return { lines: this.lineCache.size, documents: this.documentCache.size };
    }

    clear(): void {
        this.lineCache.clear();
        this.documentCache.clear();
    }

    private tokenize(
        text: string,
        ruleStack: StateStack | null,
    ): { spans: readonly HighlightSpan[]; ruleStack: StateStack } {
        const result = this.grammar.tokenizeLine(text, ruleStack);
        const spans = result.tokens
            .filter(token => token.endIndex > token.startIndex)
            .map(token => ({
                start: token.startIndex,
                length: token.endIndex - token.startIndex,
                tokenClass: classifyScopes(token.scopes),
            }));
        return { spans: mergeAdjacent(spans), ruleStack: result.ruleStack };
    }
}

export function classifyScopes(scopes: readonly string[]): AssemblyTokenClass {
    for (let index = scopes.length - 1; index >= 0; index--) {
        const scope = scopes[index];
        if (scope.startsWith('comment.line.')) { return 'line-comment'; }
        if (scope.startsWith('comment.')) { return 'comment'; }
        if (scope.startsWith('string.') || scope.startsWith('constant.character.')) { return 'string'; }
        if (scope.includes('globallabel')) { return 'global-label'; }
        if (scope.includes('locallabel')) { return 'local-label'; }
        if (scope.includes('constantslabel')) { return 'constant'; }
        if (scope.includes('entity.name.function.macro')) { return 'macro'; }
        if (scope.includes('keyword.directive')) { return 'directive'; }
        if (scope.includes('keyword.keyword')) { return 'keyword'; }
        if (scope.includes('keyword.control.flow')) { return 'control'; }
        if (scope.includes('keyword.instruction')) { return 'instruction'; }
        if (scope.includes('keyword.register')) { return 'register'; }
        if (scope.startsWith('constant.numeric.')) { return 'number'; }
        if (scope.includes('keyword.operator')) { return 'operator'; }
    }
    return 'plain';
}

async function loadGrammar(extensionRoot: string): Promise<IGrammar> {
    const grammarPath = path.join(extensionRoot, 'res', 'syntaxes', 'v6vscode_8080.tmLanguage.json');
    const wasmPath = require.resolve('vscode-oniguruma/release/onig.wasm');
    const onigLib = initializeOniguruma(wasmPath);
    const registry = new Registry({
        onigLib,
        loadGrammar: async scopeName => {
            if (scopeName !== ASSEMBLY_SCOPE) { return null; }
            return parseRawGrammar(await fs.readFile(grammarPath, 'utf8'), grammarPath);
        },
    });
    const grammar = await registry.loadGrammar(ASSEMBLY_SCOPE);
    if (!grammar) { throw new Error(`Unable to load TextMate grammar: ${ASSEMBLY_SCOPE}`); }
    return grammar;
}

async function initializeOniguruma(wasmPath: string): Promise<IOnigLib> {
    const wasm = await fs.readFile(wasmPath);
    await loadWASM(Uint8Array.from(wasm));
    return {
        createOnigScanner: sources => new OnigScanner(sources),
        createOnigString: value => new OnigString(value),
    };
}

function mergeAdjacent(spans: HighlightSpan[]): readonly HighlightSpan[] {
    const merged: HighlightSpan[] = [];
    for (const span of spans) {
        const previous = merged[merged.length - 1];
        if (previous
            && previous.tokenClass === span.tokenClass
            && previous.start + previous.length === span.start) {
            previous.length += span.length;
        } else {
            merged.push({ ...span });
        }
    }
    return merged;
}

function getLru<K, V>(cache: Map<K, V>, key: K): V | undefined {
    const value = cache.get(key);
    if (value !== undefined) {
        cache.delete(key);
        cache.set(key, value);
    }
    return value;
}

function setLru<K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void {
    cache.set(key, value);
    while (cache.size > Math.max(1, limit)) {
        cache.delete(cache.keys().next().value!);
    }
}

function normalizeSourceId(sourceId: string): string {
    return process.platform === 'win32' ? sourceId.toLowerCase() : sourceId;
}