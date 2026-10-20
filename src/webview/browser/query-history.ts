/** Bounded exact-string history; grammar validation is supplied by the feature. */
export class QueryHistory {
    private entries: string[] = [];
    private index = 0;
    private draft = '';
    constructor(private readonly limit = 50) {}
    get values(): readonly string[] { return this.entries.slice(); }
    restore(values: readonly string[]): void { this.entries = values.slice(-this.limit); this.index = this.entries.length; this.draft = ''; }
    key(key: string, value: string, valid = true): { value: string; changed: boolean; committed: boolean; prevent: boolean } {
        if (key === 'Enter' && valid && value.trim()) {
            if (this.entries[this.entries.length - 1] !== value) { this.entries.push(value); }
            this.entries = this.entries.slice(-this.limit); this.index = this.entries.length; this.draft = '';
            return { value, changed: false, committed: true, prevent: false };
        }
        if (key === 'ArrowUp') {
            if (this.index === this.entries.length) { this.draft = value; }
            if (this.index > 0) { value = this.entries[--this.index]; }
        } else if (key === 'ArrowDown') {
            if (this.index < this.entries.length - 1) { value = this.entries[++this.index]; }
            else { this.index = this.entries.length; value = this.draft; }
        } else if (key === 'Escape') { value = this.draft || ''; this.draft = ''; this.index = this.entries.length; }
        else { return { value, changed: false, committed: false, prevent: false }; }
        return { value, changed: true, committed: false, prevent: true };
    }
}