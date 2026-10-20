import type { CommandSender } from '../session/session-operations';
import { MemoryReadCapabilities } from '../protocol/memory-models';
import { MemoryCache, CachedMemoryRange } from './memory-cache';
import { MemorySpace } from '../../shared/memory-space';
import { MemoryBackend, validateMemoryCapabilities } from './memory-backend';

/** Live-view cache adapter. Never shared with a stopped debug generation. */
export class MemoryService {
    readonly cache = new MemoryCache();
    private epoch = 0;
    private readonly backend: MemoryBackend;
    private capabilities: Readonly<MemoryReadCapabilities> | undefined;

    constructor(client: CommandSender & { readonly connectionEpoch?: number; readonly connected?: boolean },
        capabilities: MemoryReadCapabilities | undefined) {
        this.backend = new MemoryBackend(client);
        this.setCapabilities(capabilities);
    }

    setCapabilities(capabilities: MemoryReadCapabilities | undefined): void {
        const checked = capabilities && validateMemoryCapabilities(capabilities);
        if (JSON.stringify(this.capabilities) === JSON.stringify(checked)) { return; }
        this.capabilities = checked;
        this.clear();
    }

    get supported(): boolean { return this.capabilities !== undefined; }
    get memoryCapabilities(): Readonly<MemoryReadCapabilities> | undefined { return this.capabilities; }

    async refreshVisible(space: MemorySpace, offset: number, length: number): Promise<CachedMemoryRange> {
        const epoch = this.epoch;
        const scope = this.backend.capture(() => {
            if (epoch !== this.epoch) { throw new Error('Memory read belongs to an inactive session'); }
        });
        const bytes = await this.backend.read(space, offset, length, this.capabilities, scope);
        scope.assertCurrent();
        // Publish atomically: a malformed later chunk cannot leave a partly fresh cache.
        this.cache.write(space, offset, bytes);
        return this.cache.read(space, offset, length);
    }

    readCached(space: MemorySpace, offset: number, length: number): CachedMemoryRange {
        return this.cache.read(space, offset, length);
    }

    async writeByte(space: MemorySpace, offset: number, value: number): Promise<void> {
        const epoch = this.epoch;
        const scope = this.backend.capture(() => {
            if (epoch !== this.epoch) { throw new Error('Memory write belongs to an inactive session'); }
        });
        await this.backend.writeByte(space, offset, value, this.capabilities, scope);
        scope.assertCurrent();
        this.cache.write(space, offset, Uint8Array.of(value));
    }

    clear(): void { this.epoch++; this.cache.clearValidity(); }
}
