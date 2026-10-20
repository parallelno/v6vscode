/** Keyed rows preserve unchanged DOM/focus; feature signatures define meaningful change. */
export class KeyedRows<T> {
    private readonly rows = new Map<string | number, { signature: string; element: HTMLElement }>();

    clear(): void { this.rows.clear(); }

    render(parent: HTMLElement, entries: readonly T[], key: (entry: T) => string | number,
        create: (entry: T) => HTMLElement, signature: (entry: T) => string = JSON.stringify): void {
        const retained = new Set<string | number>();
        entries.forEach((entry, index) => {
            const id = key(entry); const value = signature(entry); const existing = this.rows.get(id);
            const row = existing?.signature === value ? existing.element : create(entry);
            retained.add(id);
            if (existing && existing.element !== row) { existing.element.remove(); }
            this.rows.set(id, { signature: value, element: row });
            if (parent.children[index] !== row) { parent.insertBefore(row, parent.children[index] ?? null); }
        });
        for (const [id, row] of this.rows) {
            if (!retained.has(id)) { row.element.remove(); this.rows.delete(id); }
        }
    }
}