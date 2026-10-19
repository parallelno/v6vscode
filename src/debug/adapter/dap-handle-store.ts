/** Generation-bound values with wire IDs never reused during the store lifetime. */
export class DapHandleStore<T> {
    private generation = -1;
    private nextHandle = 1;
    private readonly values = new Map<number, T>();

    reset(generation: number): void {
        this.generation = generation;
        this.values.clear();
    }

    create(generation: number, value: T): number {
        if (this.generation !== generation) { this.reset(generation); }
        if (!Number.isSafeInteger(this.nextHandle)) { throw new RangeError('DAP handle space exhausted'); }
        const handle = this.nextHandle++;
        this.values.set(handle, value);
        return handle;
    }

    set(generation: number, handle: number, value: T): void {
        if (this.generation !== generation) { this.reset(generation); }
        if (!Number.isSafeInteger(handle) || handle <= 0) { throw new RangeError('Invalid DAP handle'); }
        if (handle < this.nextHandle && !this.values.has(handle)) { throw new Error('Cannot reuse an expired DAP handle'); }
        this.nextHandle = Math.max(this.nextHandle, handle + 1);
        this.values.set(handle, value);
    }

    get(generation: number, handle: number): T | undefined {
        return this.generation === generation ? this.values.get(handle) : undefined;
    }

    clear(): void {
        this.generation = -1;
        this.values.clear();
    }
}