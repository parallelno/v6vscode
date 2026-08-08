import { HighlightSpan } from '../../language/assembly-highlighter';

export type TraceLogAction = 'copyAddress' | 'copyListing' | 'toggleBreakpoint' | 'findSource';

export interface TraceLogRowViewModel {
    index: number;
    address: string;
    listing: string;
    highlights: readonly HighlightSpan[];
    links: ReadonlyArray<{ start: number; length: number; name: string }>;
    sourceBacked: boolean;
    breakpoint: boolean;
    canToggleBreakpoint: boolean;
}

export type TraceLogWebviewMessage =
    | { type: 'ready' }
    | { type: 'query'; value: string }
    | { type: 'visibleRange'; generation: number; start: number; lines: number }
    | { type: 'persist'; query: string; history: string[] }
    | { type: 'action'; generation: number; index: number; action: TraceLogAction }
    | { type: 'link'; generation: number; index: number; start: number; length: number };

export type TraceLogHostMessage =
    | { type: 'restored'; query: string; history: string[] }
    | { type: 'state'; state: 'noSession' | 'unsupported' | 'running' | 'loading' | 'ready' | 'empty' | 'error'; message: string }
    | { type: 'queryError'; message: string }
    | { type: 'reset' }
    | { type: 'filter'; generation: number; totalMatches: number }
    | { type: 'window'; generation: number; start: number; rows: readonly TraceLogRowViewModel[] }
    | { type: 'breakpoints'; generation: number; values: ReadonlyArray<{ index: number; breakpoint: boolean }> }
    | { type: 'dismissMenus' };