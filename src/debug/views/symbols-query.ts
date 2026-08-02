import { IndexedSymbol } from '../metadata/debug-symbol-service';
import { bareSymbol, evaluateSymbolExpression } from '../utilities/symbol-expression';

export interface SymbolFilterOptions {
    matchCase: boolean;
    wholeWord: boolean;
}

export interface SymbolFilterResult {
    matches: ReadonlyArray<IndexedSymbol>;
    expressionError?: string;
}

export function filterSymbols(
    symbols: ReadonlyArray<IndexedSymbol>,
    input: string,
    options: SymbolFilterOptions,
): SymbolFilterResult {
    const query = input.trim();
    if (!query) {
        return { matches: symbols };
    }

    const comparedQuery = options.matchCase ? query : query.toLocaleLowerCase();
    const matches = new Set<string>();
    for (const symbol of symbols) {
        const comparedName = options.matchCase ? symbol.name : symbol.name.toLocaleLowerCase();
        const nameMatches = options.wholeWord
            ? comparedName === comparedQuery
            : comparedName.includes(comparedQuery);
        if (nameMatches) {
            matches.add(symbol.id);
        }
    }

    let expressionError: string | undefined;
    try {
        const value = evaluateSymbolExpression(query, name => {
            const candidates = symbols.filter(symbol => symbol.name === name);
            if (candidates.length === 0) { throw new Error(`Symbol not found: ${name}`); }
            if (candidates.length > 1) { throw new Error(`Symbol is ambiguous: ${name}`); }
            return candidates[0].address;
        });
        if (value >= 0 && value <= 0xFFFF) {
            symbols.filter(symbol => symbol.address === value).forEach(symbol => matches.add(symbol.id));
        } else if (matches.size === 0) {
            expressionError = `Address is outside 0x0000..0xFFFF: ${query}`;
        }
    } catch (error) {
        if (matches.size === 0 && !bareSymbol(query)) {
            expressionError = error instanceof Error ? error.message : String(error);
        }
    }

    return {
        matches: symbols.filter(symbol => matches.has(symbol.id)),
        expressionError,
    };
}