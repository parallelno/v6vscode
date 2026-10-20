export interface RefreshPolicy {
    enabled(): boolean;
    capture(): () => boolean;
    refresh(current: () => boolean, full: boolean): Promise<void>;
    failed(error: unknown): void;
    intervalMs: number;
    maxBackoffMs: number;
}

/** Single active refresh, one latest follow-up, and completion-based polling. */
export class RefreshController {
    private inFlight: Promise<void> | undefined;
    private pending = false;
    private full = false;
    private polling = false;
    private disposed = false;
    private revision = 0;
    private failures = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;

    constructor(private readonly policy: RefreshPolicy) {}

    request(full = false): Promise<void> {
        if (this.disposed || !this.policy.enabled()) { return Promise.resolve(); }
        this.pending = true;
        this.full ||= full;
        if (this.inFlight) { return this.inFlight; }
        const result = this.drain();
        this.inFlight = result;
        const finish = () => { if (this.inFlight === result) { this.inFlight = undefined; } };
        void result.then(finish, finish);
        return result;
    }

    private async drain(): Promise<void> {
        while (this.pending && !this.disposed && this.policy.enabled()) {
            this.pending = false;
            const full = this.full; this.full = false;
            const revision = this.revision;
            const captured = this.policy.capture();
            const current = () => !this.disposed && revision === this.revision && this.policy.enabled() && captured();
            if (!current()) { continue; }
            try { await this.policy.refresh(current, full); }
            catch (error) { if (current()) { throw error; } }
        }
    }

    start(): void { this.polling = true; this.schedule(); }
    stop(): void {
        this.polling = false; this.revision++; this.pending = false; this.full = false;
        if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined; }
    }
    dispose(): void { this.stop(); this.disposed = true; }

    private schedule(): void {
        if (this.timer !== undefined || !this.polling || this.disposed || !this.policy.enabled()) { return; }
        const revision = this.revision;
        const delay = Math.min(this.policy.maxBackoffMs, this.policy.intervalMs * 2 ** Math.min(this.failures, 10));
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const current = this.policy.capture();
            void this.request().then(() => { this.failures = 0; }, error => {
                if (revision === this.revision && current() && !this.disposed) { this.failures++; this.policy.failed(error); }
            }).finally(() => { if (revision === this.revision) { this.schedule(); } });
        }, delay);
    }
}