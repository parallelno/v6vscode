import { WatchpointEntry } from '../../emulator/protocol/debug-models';
import { WatchpointViewEntry } from './watchpoints-messages';

export class WatchpointExpressionStore {
    private readonly expressions = new Map<number, string>();
    private generation = 0;

    set(id: number, expression: string | number): void {
        this.expressions.set(id, typeof expression === 'string' ? expression : String(expression));
    }

    delete(id: number): void {
        this.expressions.delete(id);
    }

    clear(): void {
        this.expressions.clear();
    }

    decorate(entries: readonly WatchpointEntry[], generation: number): readonly WatchpointViewEntry[] {
        if (generation !== this.generation) {
            this.expressions.clear();
            this.generation = generation;
        }
        const ids = new Set(entries.map(entry => entry.id));
        for (const id of this.expressions.keys()) {
            if (!ids.has(id)) { this.expressions.delete(id); }
        }
        return entries.map(entry => ({
            ...entry,
            globalAddr: this.expressions.get(entry.id) ?? String(entry.globalAddr),
        }));
    }
}