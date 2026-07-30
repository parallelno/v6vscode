import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { V6emulLocator, V6emulLocatorDeps } from '../../../src/emulator/launcher/v6emul-locator';
import { ErrorCode } from '../../../src/platform/errors/error-codes';
import { V6Error } from '../../../src/platform/errors/v6-error';

function makeLogger() {
    return {
        error: () => {},
        warn: () => {},
        info: () => {},
        debug: () => {},
        dispose: () => {},
    } as any;
}

function makeDeps(overrides: Partial<V6emulLocatorDeps> = {}): V6emulLocatorDeps {
    return {
        logger: makeLogger(),
        getConfiguration: () => ({ get: () => '' }),
        getEnv: () => undefined,
        which: () => undefined,
        ...overrides,
    };
}

describe('V6emulLocator', () => {
    it('should return setting path when it exists', () => {
        // Use a real file as the "emulator" (package.json exists)
        const realFile = path.join(__dirname, '..', '..', '..', 'package.json');
        const deps = makeDeps({
            getConfiguration: () => ({ get: () => realFile }),
        });
        const locator = new V6emulLocator(deps);
        expect(locator.resolve()).to.equal(realFile);
    });

    it('should warn and fall through when setting path does not exist', () => {
        let warned = false;
        const deps = makeDeps({
            getConfiguration: () => ({ get: () => '/nonexistent/setting/path' }),
            logger: { ...makeLogger(), warn: () => { warned = true; } },
            which: () => '/usr/bin/v6emul',
        });
        const result = new V6emulLocator(deps).resolve();
        expect(result).to.equal('/usr/bin/v6emul');
        expect(warned).to.be.true;
    });

    it('should use env variable V6EMUL when setting is absent', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6emultest-'));
        const envPath = path.join(tmpDir, 'v6emul.exe');
        fs.writeFileSync(envPath, 'fake');
        try {
            const deps = makeDeps({ getEnv: (n) => n === 'V6EMUL' ? envPath : undefined });
            expect(new V6emulLocator(deps).resolve()).to.equal(envPath);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should warn and fall through when env V6EMUL path does not exist', () => {
        let warned = false;
        const deps = makeDeps({
            getEnv: () => '/nonexistent/v6emul',
            logger: { ...makeLogger(), warn: () => { warned = true; } },
            which: () => '/usr/local/bin/v6emul',
        });
        const result = new V6emulLocator(deps).resolve();
        expect(result).to.equal('/usr/local/bin/v6emul');
        expect(warned).to.be.true;
    });

    it('should fall through to PATH lookup when setting and env are absent', () => {
        const deps = makeDeps({
            which: (name: string) => name === 'v6emul' ? '/usr/bin/v6emul' : undefined,
        });
        const locator = new V6emulLocator(deps);
        expect(locator.resolve()).to.equal('/usr/bin/v6emul');
    });

    it('should throw EMULATOR_NOT_FOUND when all lookups fail', () => {
        const deps = makeDeps();
        const locator = new V6emulLocator(deps);
        expect(() => locator.resolve()).to.throw(V6Error).with.property('code', ErrorCode.EMULATOR_NOT_FOUND);
    });

    it('should prefer setting over env and PATH', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6emultest-'));
        const settingFile = path.join(tmpDir, 'setting-v6emul');
        const envFile = path.join(tmpDir, 'env-v6emul');
        fs.writeFileSync(settingFile, 'fake-setting');
        fs.writeFileSync(envFile, 'fake-env');
        try {
            const deps = makeDeps({
                getConfiguration: () => ({ get: () => settingFile }),
                getEnv: () => envFile,
                which: () => '/usr/bin/v6emul',
            });
            expect(new V6emulLocator(deps).resolve()).to.equal(settingFile);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should prefer env over PATH when setting is absent', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6emultest-'));
        const envFile = path.join(tmpDir, 'env-v6emul');
        fs.writeFileSync(envFile, 'fake-env');
        try {
            const deps = makeDeps({
                getEnv: () => envFile,
                which: () => '/usr/bin/v6emul',
            });
            expect(new V6emulLocator(deps).resolve()).to.equal(envFile);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
