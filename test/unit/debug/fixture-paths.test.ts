import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fixturePath, fixtureRom, repositoryRoot } from '../../helpers/fixture-paths';

const modes = ['O0', 'O1', 'O2'];

describe('Mandatory debug fixtures', () => {
    it('resolves the same root from source and compiled test locations', () => {
        const root = repositoryRoot();
        assert.strictEqual(repositoryRoot(path.join(root, 'test', 'unit', 'debug')), root);
        assert.strictEqual(repositoryRoot(path.join(root, 'out', 'test', 'unit', 'debug')), root);
        assert.throws(() => fixturePath('not-present.elf'), /Required test fixture is missing/);
    });

    it('verifies pinned ELF and source hashes independently of external tool availability', () => {
        const manifest = JSON.parse(fs.readFileSync(fixturePath('debug-fixtures.json'), 'utf8')) as { files: Record<string, string> };
        for (const [file, expected] of Object.entries(manifest.files)) {
            const actual = createHash('sha256').update(fs.readFileSync(fixturePath(...file.split('/')))).digest('hex');
            assert.strictEqual(actual, expected, file);
        }
    });

    it('derives ROMs deterministically from checked-in loadable ELF sections', () => {
        for (const elf of [fixturePath('baseline', 'demo1.elf'), ...modes.map(mode => fixturePath('cdbg', `probe-${mode}.elf`))]) {
            const rom = fixtureRom(elf);
            const before = fs.readFileSync(rom);
            assert.strictEqual(fixtureRom(elf), rom);
            assert.deepStrictEqual(fs.readFileSync(rom), before);
            assert.ok(before.length > 0);
        }
    });
});
