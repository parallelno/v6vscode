export interface StepBreakpointBackend {
    add(address: number): Promise<boolean>;
    remove(address: number): Promise<void>;
}

/** Tracks debugger-owned step breakpoint references independently from user breakpoints. */
export class StepBreakpointStore {
    private readonly temporaryReferences = new Map<number, number>();
    private readonly userAddresses = new Set<number>();

    constructor(private readonly backend: StepBreakpointBackend) {}

    async acquire(address: number): Promise<boolean> {
        const count = this.temporaryReferences.get(address) ?? 0;
        if (count === 0 && !this.userAddresses.has(address) && !await this.backend.add(address)) {
            return false;
        }
        this.temporaryReferences.set(address, count + 1);
        return true;
    }

    async release(address: number): Promise<void> {
        const count = this.temporaryReferences.get(address);
        if (!count) { return; }
        if (count > 1) {
            this.temporaryReferences.set(address, count - 1);
            return;
        }
        this.temporaryReferences.delete(address);
        if (!this.userAddresses.has(address)) { await this.backend.remove(address); }
    }

    setUserOwned(address: number, owned: boolean): void {
        if (owned) { this.userAddresses.add(address); }
        else { this.userAddresses.delete(address); }
    }

    async restoreTemporary(address: number): Promise<boolean> {
        return this.temporaryReferences.has(address)
            && !this.userAddresses.has(address)
            ? this.backend.add(address)
            : true;
    }

    isTemporary(address: number): boolean {
        return this.temporaryReferences.has(address);
    }

    isUserOwned(address: number): boolean {
        return this.userAddresses.has(address);
    }

    async clear(): Promise<void> {
        const addresses = [...this.temporaryReferences.keys()];
        this.temporaryReferences.clear();
        await Promise.all(addresses
            .filter(address => !this.userAddresses.has(address))
            .map(address => this.backend.remove(address)));
    }
}