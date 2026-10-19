import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { decodeDebugArtifact, LoadResult } from './debug-artifact-loader';

export interface ArtifactHandle extends Readonly<LoadResult> {
    readonly version: string;
    readonly artifactPath: string;
    readonly executablePath: string;
}

export interface ArtifactBytes { elf: Buffer; executable?: Buffer }
export interface ArtifactSource {
    read(artifactPath: string, executablePath: string): Promise<ArtifactBytes>;
}

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const diskSource: ArtifactSource = {
    async read(artifactPath, executablePath) {
        async function boundedRead(file: string): Promise<Buffer> {
            const stat = await fs.stat(file);
            if (stat.size > MAX_ARTIFACT_BYTES) { throw new Error(`Debug artifact input exceeds ${MAX_ARTIFACT_BYTES} bytes: ${file}`); }
            const bytes = await fs.readFile(file);
            if (bytes.length > MAX_ARTIFACT_BYTES) { throw new Error(`Debug artifact input grew beyond byte limit: ${file}`); }
            return bytes;
        }
        const elf = await boundedRead(artifactPath);
        let executable: Buffer | undefined;
        if (executablePath) {
            try { executable = await boundedRead(executablePath); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
        }
        return { elf, executable };
    },
};

/** Bounded cache of immutable versions. Selection and lifecycle belong to consumers, not this cache. */
export class ArtifactRepository {
    private readonly cache = new Map<string, ArtifactHandle>();
    private readonly pending = new Map<string, Promise<ArtifactHandle>>();
    private invalidation = 0;

    constructor(private readonly source: ArtifactSource = diskSource,
        private readonly decode: (elf: Buffer, executable?: Buffer) => LoadResult = decodeDebugArtifact,
        private readonly maxEntries = 8) {
        if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) { throw new RangeError('Artifact cache size must be positive'); }
    }

    load(artifactPath: string, executablePath = '', force = false): Promise<ArtifactHandle> {
        const artifact = canonicalPath(artifactPath);
        const executable = executablePath ? canonicalPath(executablePath) : '';
        const identity = JSON.stringify([artifact, executable]);
        if (force) { this.invalidate(); }
        const revision = this.invalidation;
        const requestKey = `${revision}:${identity}`;
        const existing = this.pending.get(requestKey);
        if (existing) { return existing; }
        const request = this.readVersion(artifact, executable, identity, revision);
        this.pending.set(requestKey, request);
        const clear = () => { if (this.pending.get(requestKey) === request) { this.pending.delete(requestKey); } };
        void request.then(clear, clear);
        return request;
    }

    invalidate(): void {
        this.invalidation++;
        this.cache.clear();
    }

    private async readVersion(artifact: string, executable: string, identity: string, revision: number): Promise<ArtifactHandle> {
        const bytes = await this.source.read(artifact, executable);
        const hash = createHash('sha256').update(String(bytes.elf.length)).update(':').update(bytes.elf);
        hash.update(bytes.executable === undefined ? ':missing' : `:executable:${bytes.executable.length}:`);
        if (bytes.executable) { hash.update(bytes.executable); }
        const version = `${identity}:${hash.digest('hex')}`;
        const key = `${revision}:${version}`;
        const cached = this.cache.get(key);
        if (cached) {
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached;
        }
        const result = this.decode(bytes.elf, bytes.executable);
        const handle = Object.freeze({ ...result, metadata: result.metadata && readOnlyMetadata(result.metadata),
            version, artifactPath: artifact, executablePath: executable });
        // A forced reload may have superseded this read. Its handle remains valid for its caller only.
        if (revision === this.invalidation) {
            this.cache.set(key, handle);
            while (this.cache.size > this.maxEntries) { this.cache.delete(this.cache.keys().next().value!); }
        }
        return handle;
    }
}

/** Keep lazy parser caches private while publishing read-only query results.
 * Buffers are defensive copies: freezing a typed-array view is not supported by Node.
 */
function readOnlyMetadata<T extends object>(root: T): T {
    const proxies = new WeakMap<object, object>();
    const mutators = new Set(['set', 'delete', 'clear', 'add', 'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
    function wrap(value: unknown): unknown {
        if (Buffer.isBuffer(value)) { return Buffer.from(value); }
        if (value === null || typeof value !== 'object') { return value; }
        const existing = proxies.get(value);
        if (existing) { return existing; }
        const proxy = new Proxy(value, {
            set() { throw new TypeError('Artifact metadata is read-only'); },
            deleteProperty() { throw new TypeError('Artifact metadata is read-only'); },
            defineProperty() { throw new TypeError('Artifact metadata is read-only'); },
            get(target, property) {
                const member = Reflect.get(target, property, target);
                if (typeof member !== 'function') { return wrap(member); }
                if ((target instanceof Map || target instanceof Set || Array.isArray(target)) && mutators.has(String(property))) {
                    return () => { throw new TypeError('Artifact metadata is read-only'); };
                }
                if (property === 'forEach' && target instanceof Map) {
                    return (callback: (value: unknown, key: unknown) => void) => target.forEach((value, key) => callback(wrap(value), wrap(key)));
                }
                // Array callbacks must see wrapped elements, not private records.
                if (Array.isArray(target)) { return (...args: unknown[]) => wrap(Reflect.apply(member, proxy, args)); }
                return (...args: unknown[]) => wrap(Reflect.apply(member, target, args));
            },
        });
        proxies.set(value, proxy);
        return proxy;
    }
    return wrap(root) as T;
}

function canonicalPath(file: string): string {
    const normalized = path.normalize(path.resolve(file));
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Shared cache, never a shared mutable active selection. */
export const artifactRepository = new ArtifactRepository();