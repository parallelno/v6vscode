import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { V6emulLocator, V6emulLocatorDeps } from '../../../src/emulator/launcher/v6emul-locator';
import { ErrorCode } from '../../../src/platform/errors/error-codes';
import { V6Error } from '../../../src/platform/errors/v6-error';

// Minimal stubs
function makeLogger() {
    return {
        error: () => {},
        warn: () => {},
        info: () => {},
        debug: () => {},
        dispose: () => {},
    } as any;
}

function makePathService(extensionPath: string) {
    return {
        resolveExtensionPath: (rel: string) => path.join(extensionPath, rel),
        expandTokens: (v: string) => v,
        resolveRelative: (base: string, rel: string) => path.resolve(base, rel),
    } as any;
}

function makeDeps(overrides: Partial<V6emulLocatorDeps> = {}): V6emulLocatorDeps {
    return {
        pathService: makePathService('/nonexistent/ext'),
        logger: makeLogger(),
        getConfiguration: () => ({ get: () => '' }),
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

    it('should fall through to bundled when setting path does not exist', () => {
        // Create a temp file to simulate the bundled binary
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6test-'));
        const bundledDir = path.join(tmpDir, 'res', 'v6emul');
        fs.mkdirSync(bundledDir, { recursive: true });
        const bundledPath = path.join(bundledDir, 'v6emul');
        fs.writeFileSync(bundledPath, 'fake');

        try {
            const deps = makeDeps({
                pathService: makePathService(tmpDir),
                getConfiguration: () => ({ get: () => '/nonexistent/setting/path' }),
            });
            const locator = new V6emulLocator(deps);
            expect(locator.resolve()).to.equal(bundledPath);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should fall through to PATH lookup when bundled does not exist', () => {
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

    it('should try bundled .exe path on Windows', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6test-'));
        const bundledDir = path.join(tmpDir, 'res', 'v6emul');
        fs.mkdirSync(bundledDir, { recursive: true });
        const bundledPathExe = path.join(bundledDir, 'v6emul.exe');
        fs.writeFileSync(bundledPathExe, 'fake');

        try {
            const deps = makeDeps({
                pathService: makePathService(tmpDir),
            });
            const locator = new V6emulLocator(deps);
            expect(locator.resolve()).to.equal(bundledPathExe);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should prefer setting over bundled', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6test-'));
        const bundledDir = path.join(tmpDir, 'res', 'v6emul');
        fs.mkdirSync(bundledDir, { recursive: true });
        const bundledPath = path.join(bundledDir, 'v6emul');
        fs.writeFileSync(bundledPath, 'fake-bundled');

        const settingFile = path.join(tmpDir, 'custom-v6emul');
        fs.writeFileSync(settingFile, 'fake-setting');

        try {
            const deps = makeDeps({
                pathService: makePathService(tmpDir),
                getConfiguration: () => ({ get: () => settingFile }),
            });
            const locator = new V6emulLocator(deps);
            expect(locator.resolve()).to.equal(settingFile);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should prefer bundled over PATH', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6test-'));
        const bundledDir = path.join(tmpDir, 'res', 'v6emul');
        fs.mkdirSync(bundledDir, { recursive: true });
        const bundledPath = path.join(bundledDir, 'v6emul');
        fs.writeFileSync(bundledPath, 'fake-bundled');

        try {
            const deps = makeDeps({
                pathService: makePathService(tmpDir),
                which: () => '/usr/bin/v6emul',
            });
            const locator = new V6emulLocator(deps);
            expect(locator.resolve()).to.equal(bundledPath);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
