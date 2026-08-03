export class EntryExpressionStore<T extends { id: number }, K extends keyof T> {
    private readonly expressions = new Map<number, Partial<Record<K, string>>>();
    private generation = 0;

    constructor(
        private readonly fields: readonly K[],
        private readonly stringify: (field: K, value: T[K]) => string = (_field, value) => String(value),
    ) {}

    set(id: number, values: { [P in K]: T[P] | string }): void {
        const expressions: Partial<Record<K, string>> = {};
        for (const field of this.fields) {
            expressions[field] = String(values[field]);
        }
        this.expressions.set(id, expressions);
    }

    delete(id: number): void {
        this.expressions.delete(id);
    }

    clear(): void {
        this.expressions.clear();
    }

    decorate(entries: readonly T[], generation: number): ReadonlyArray<Omit<T, K> & Record<K, string>> {
        if (generation !== this.generation) {
            this.expressions.clear();
            this.generation = generation;
        }
        const ids = new Set(entries.map(entry => entry.id));
        for (const id of this.expressions.keys()) {
            if (!ids.has(id)) { this.expressions.delete(id); }
        }
        return entries.map(entry => {
            const decorated = { ...entry } as Omit<T, K> & Record<K, string>;
            const expressions = this.expressions.get(entry.id);
            for (const field of this.fields) {
                (decorated as Record<K, string>)[field] = expressions?.[field] ?? this.stringify(field, entry[field]);
            }
            return decorated;
        });
    }
}