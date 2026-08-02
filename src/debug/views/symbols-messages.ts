export type SymbolAction = 'copyName' | 'copyValue' | 'findSource' | 'findHex';

export interface SymbolListItem {
    id: string;
    name: string;
    value: string;
    canFindSource: boolean;
}

export type SymbolsWebviewMessage =
    | { type: 'ready' }
    | { type: 'query'; value: string; matchCase: boolean; wholeWord: boolean }
    | { type: 'persist'; query: string; history: string[]; matchCase: boolean; wholeWord: boolean }
    | { type: 'action'; id: string; action: SymbolAction };

export type SymbolsHostMessage =
    | { type: 'restored'; query: string; history: string[]; matchCase: boolean; wholeWord: boolean }
    | { type: 'state'; state: 'loading' | 'ready' | 'empty' | 'error'; message: string }
    | { type: 'results'; items: SymbolListItem[]; total: number; error?: string };