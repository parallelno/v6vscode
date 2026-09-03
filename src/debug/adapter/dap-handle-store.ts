/** Stores DAP handles that are valid for exactly one stopped generation. */
export class DapHandleStore<T> {
    private generation = -1;
    private nextHandle = 1;
    private readonly values = new Map<number, T>();

    reset(generation: number): void {
        this.generation = generation;
        this.nextHandle = 1;
        this.values.clear();
    }

    create(generation: number, value: T): number {
        if (this.generation !== generation) { this.reset(generation); }
        const handle = this.nextHandle++;
        this.values.set(handle, value);
        return handle;
    }

    set(generation: number, handle: number, value: T): void {
        if (this.generation !== generation) { this.reset(generation); }
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