import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ArtifactRepository } from '../../../src/debug/metadata/artifact-repository';
import { decodeDebugArtifact } from '../../../src/debug/metadata/debug-artifact-loader';
import { DebugSymbolService } from '../../../src/debug/metadata/debug-symbol-service';
import { fixturePath, fixtureRom } from '../../helpers/fixture-paths';

describe('Versioned artifact ownership', () => {
    let directory: string;
    let elf: string;
    let rom: string;
    beforeEach(() => {
        directory = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-artifact-'));
        elf = path.join(directory, 'main.elf'); rom = path.join(directory, 'main.rom');
        const source = fixturePath('asm-values', 'main.elf');
        fs.copyFileSync(source, elf); fs.copyFileSync(fixtureRom(source), rom);
    });
    afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

    it('coalesces concurrent loads and reuses parsed immutable versions', async () => {
        let parses = 0;
        const repository = new ArtifactRepository(undefined, (elf, rom) => { parses++; return decodeDebugArtifact(elf, rom); });
        const first = repository.load(elf, rom);
        assert.strictEqual(repository.load(elf, rom), first);
        const handle = await first;
        assert.strictEqual(await repository.load(elf, rom), handle);
        assert.strictEqual(parses, 1);
        assert.ok(Object.isFrozen(handle));
        assert.throws(() => (handle.index.allSymbols() as any[]).push({}));
        assert.throws(() => { handle.index.allSymbols()[0].address = 123; });
        assert.throws(() => { handle.index.statementRows[0].line = 999; });
        const variable = handle.metadata?.scopes.variables[0];
        if (variable) { assert.throws(() => { variable.name = 'corrupted'; }, /read-only/); }
        if (variable?.location?.length) {
            const copy = variable.location;
            const byte = copy[0]; copy[0] ^= 1;
            assert.strictEqual(variable.location[0], byte, 'Location byte buffers must be defensive copies');
        }
        const subprograms = handle.metadata?.scopes.subprograms;
        if (subprograms?.length) {
            const [subprogram] = subprograms;
            assert.throws(() => { subprogram.name = 'corrupted'; }, /read-only/);
        }
        assert.strictEqual(await repository.load(elf, rom), handle);
    });

    it('detects same-size/same-mtime rebuilds at the same path', async () => {
        const repository = new ArtifactRepository();
        const before = await repository.load(elf, rom);
        const stat = fs.statSync(elf);
        const bytes = fs.readFileSync(elf);
        const marker = bytes.indexOf(Buffer.from('set_timer\0'));
        assert.ok(marker >= 0);
        bytes.write('new_timer', marker, 'ascii');
        fs.writeFileSync(elf, bytes);
        fs.utimesSync(elf, stat.atime, stat.mtime);
        const after = await repository.load(elf, rom);
        assert.notStrictEqual(after.version, before.version);
        assert.ok(before.index.symbol('set_timer'));
        assert.ok(after.index.symbol('new_timer'));
        assert.strictEqual(after.index.symbol('set_timer'), undefined);
    });

    it('includes executable identity/content in validation and recovers after failure', async () => {
        const repository = new ArtifactRepository();
        const original = await repository.load(elf, rom);
        const bytes = fs.readFileSync(rom); bytes[0] ^= 1; fs.writeFileSync(rom, bytes);
        await assert.rejects(repository.load(elf, rom), /does not match ROM/);
        bytes[0] ^= 1; fs.writeFileSync(rom, bytes);
        assert.strictEqual(await repository.load(elf, rom), original);
        const other = path.join(directory, 'other.rom'); fs.writeFileSync(other, bytes);
        assert.notStrictEqual((await repository.load(elf, other)).version, original.version);
    });

    it('allows forced reload and bounded eviction without invalidating old handles', async () => {
        let parses = 0;
        const repository = new ArtifactRepository(undefined, (elf, rom) => { parses++; return decodeDebugArtifact(elf, rom); }, 1);
        const first = await repository.load(elf, rom);
        const other = path.join(directory, 'other.elf'); fs.copyFileSync(elf, other);
        await repository.load(other, rom);
        await repository.load(elf, rom);
        assert.strictEqual(parses, 3);
        const forced = await repository.load(elf, rom, true);
        assert.notStrictEqual(forced, first);
        assert.strictEqual(forced.version, first.version);
        assert.ok(first.index.symbol('set_timer'));
    });

    it('isolates consumer clears/failures and prevents a delayed load from undoing a clear', async () => {
        const repository = new ArtifactRepository();
        const first = new DebugSymbolService(repository), second = first.fork();
        await Promise.all([first.load(elf, rom), second.load(elf, rom)]);
        assert.strictEqual(first.snapshot, second.snapshot);
        const ids = first.allSymbols().map(symbol => symbol.id);
        await first.load(elf, rom);
        assert.deepStrictEqual(first.allSymbols().map(symbol => symbol.id), ids);
        const retained = second.snapshot;
        const pending = first.load(elf, rom);
        first.clear();
        await pending;
        assert.strictEqual(first.snapshot, undefined);
        assert.strictEqual(second.snapshot, retained);
        await assert.rejects(first.load(path.join(directory, 'missing.elf'), rom));
        assert.ok(second.requireSymbolAddress('set_timer') >= 0);
    });

    it('does not let an invalidated in-flight read overwrite the forced version', async () => {
        const bytes = fs.readFileSync(elf), executable = fs.readFileSync(rom);
        let finish!: (value: { elf: Buffer; executable: Buffer }) => void;
        let reads = 0;
        const repository = new ArtifactRepository({ read: async () => ++reads === 1
            ? new Promise(resolve => { finish = resolve; }) : { elf: bytes, executable } });
        const pending = repository.load(elf, rom);
        const forced = await repository.load(elf, rom, true);
        finish({ elf: bytes, executable });
        const old = await pending;
        assert.notStrictEqual(old, forced);
        assert.strictEqual(await repository.load(elf, rom), forced);
    });

    it('keeps the newest consumer selection after an older path finishes loading', async () => {
        const bytes = fs.readFileSync(elf), executable = fs.readFileSync(rom);
        let finish!: (value: { elf: Buffer; executable: Buffer }) => void;
        let reads = 0;
        const repository = new ArtifactRepository({ read: async () => ++reads === 1
            ? new Promise(resolve => { finish = resolve; }) : { elf: bytes, executable } });
        const symbols = new DebugSymbolService(repository);
        const first = symbols.load(elf, rom);
        await symbols.load(path.join(directory, 'new.elf'), rom);
        const selected = symbols.snapshot;
        finish({ elf: bytes, executable });
        await first;
        assert.strictEqual(symbols.snapshot, selected);
        assert.ok(selected?.artifactPath.endsWith('new.elf'));
    });
});