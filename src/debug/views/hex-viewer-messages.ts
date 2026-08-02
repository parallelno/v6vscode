import { MemorySpace } from '../../emulator/memory/memory-space';

export type HexViewerWebviewMessage =
    | { type: 'ready' }
    | { type: 'visibleRange'; space: MemorySpace; offset: number; length: number }
    | { type: 'selectSpace'; space: MemorySpace }
    | { type: 'query'; value: string }
    | { type: 'editByte'; space: MemorySpace; address: number; expression: string; previousValue: number }
    | { type: 'copy'; target: 'byte' | 'symbol'; value: string; address: number; space: MemorySpace }
    | { type: 'findSource'; address: number; space: MemorySpace }
    | { type: 'persist'; space: MemorySpace; query: string; history: string[] };

export type HexViewerHostMessage =
    | { type: 'state'; state: 'noSession' | 'unsupported' | 'ready' | 'running' | 'stale' | 'error'; message: string }
    | { type: 'reset' }
    | { type: 'spaces'; spaces: Array<{ space: MemorySpace; label: string }>; selected: MemorySpace }
    | { type: 'editing'; enabled: boolean }
    | { type: 'memory'; space: MemorySpace; offset: number; values: Uint8Array; valid: Uint8Array; symbols: Array<{ name: string; address: number; size: number }>; sourceAddresses: number[] }
    | { type: 'byteEdit'; space: MemorySpace; address: number; ok: boolean; value?: number; message: string }
    | { type: 'navigate'; space?: MemorySpace; start: number; end: number; query?: string; commitHistory?: boolean }
    | { type: 'clearHighlight' }
    | { type: 'queryError'; message: string }
    | { type: 'restored'; space: MemorySpace; query: string; history: string[] };