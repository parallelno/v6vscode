export interface OperationScope {
    readonly key: object;
    assertCurrent(): void;
}

/** Serialize transactions within one scope, without blocking a replacement session. */
export class ScopedTaskQueue {
    private readonly tails = new Map<object, Promise<void>>();

    run<T>(scope: OperationScope, operation: () => Promise<T>): Promise<T> {
        const result = (this.tails.get(scope.key) ?? Promise.resolve()).then(async () => {
            scope.assertCurrent();
            const value = await operation();
            scope.assertCurrent();
            return value;
        });
        const tail = result.then(() => undefined, () => undefined);
        this.tails.set(scope.key, tail);
        void tail.then(() => { if (this.tails.get(scope.key) === tail) { this.tails.delete(scope.key); } });
        return result;
    }
}

/** Coalesce only callers observing the same session/revision key. */
export class SingleFlight<T> {
    private readonly pending = new Map<object, Promise<T>>();

    run(key: object, operation: () => Promise<T>): Promise<T> {
        const existing = this.pending.get(key);
        if (existing) { return existing; }
        let result: Promise<T>;
        try { result = operation(); } catch (error) { result = Promise.reject(error); }
        this.pending.set(key, result);
        const clear = () => { if (this.pending.get(key) === result) { this.pending.delete(key); } };
        void result.then(clear, clear);
        return result;
    }
}
