import type { MemorySpace } from '../../shared/memory-space';
import type { SourceLocation } from '../metadata/debug-index';

export interface MemoryNavigation {
    revealRange(space: MemorySpace, start: number, end: number): void;
    open(): void;
}
export interface SymbolMemoryNavigation { revealSymbol(name: string, start: number, end: number): void }
export interface SourceNavigation { reveal(source: SourceLocation, projectRoot: string): Promise<void> }