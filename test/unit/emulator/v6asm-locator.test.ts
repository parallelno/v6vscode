import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { V6asmLocator, V6asmLocatorDeps } from '../../../src/emulator/launcher/v6asm-locator';
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

function makeDeps(overrides: Partial<V6asmLocatorDeps> = {}): V6asmLocatorDeps {
    return {
        logger: makeLogger(),
        getConfiguration: () => ({ get: () => '' }),
        getEnv: () => undefined,
        which: () => undefined,
        ...overrides,
    };
}

describe('V6asmLocator', () => {
    it('should return setting path when it exists', () => {
        const realFile = path.join(__dirname, '..', '..', '..', 'package.json');
        const deps = makeDeps({
            getConfiguration: () => ({ get: () => realFile }),
        });
        expect(new V6asmLocator(deps).resolve()).to.equal(realFile);
    });

    it('should warn and fall through when setting path does not exist', () => {
        let warned = false;
        const deps = makeDeps({
            getConfiguration: () => ({ get: () => '/nonexistent/v6asm' }),
            logger: { ...makeLogger(), warn: () => { warned = true; } },
            which: () => '/usr/bin/v6asm',
        });
        const result = new V6asmLocator(deps).resolve();
        expect(result).to.equal('/usr/bin/v6asm');
        expect(warned).to.be.true;
    });

    it('should use env variable V6ASM when setting is absent', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6asmtest-'));
        const envPath = path.join(tmpDir, 'v6asm.exe');
        fs.writeFileSync(envPath, 'fake');
        try {
            const deps = makeDeps({ getEnv: (n) => n === 'V6ASM' ? envPath : undefined });
            expect(new V6asmLocator(deps).resolve()).to.equal(envPath);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should warn and fall through when env V6ASM path does not exist', () => {
        let warned = false;
        const deps = makeDeps({
            getEnv: () => '/nonexistent/v6asm',
            logger: { ...makeLogger(), warn: () => { warned = true; } },
            which: () => '/usr/local/bin/v6asm',
        });
        const result = new V6asmLocator(deps).resolve();
        expect(result).to.equal('/usr/local/bin/v6asm');
        expect(warned).to.be.true;
    });

    it('should use PATH lookup when setting and env are absent', () => {
        const deps = makeDeps({ which: (n) => n === 'v6asm' ? '/usr/bin/v6asm' : undefined });
        expect(new V6asmLocator(deps).resolve()).to.equal('/usr/bin/v6asm');
    });

    it('should throw ASSEMBLER_NOT_FOUND when all lookups fail', () => {
        const deps = makeDeps();
        expect(() => new V6asmLocator(deps).resolve())
            .to.throw(V6Error)
            .with.property('code', ErrorCode.ASSEMBLER_NOT_FOUND);
    });

    it('should prefer setting over env and PATH', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6asmtest-'));
        const settingFile = path.join(tmpDir, 'setting-v6asm');
        const envFile = path.join(tmpDir, 'env-v6asm');
        fs.writeFileSync(settingFile, 'fake-setting');
        fs.writeFileSync(envFile, 'fake-env');
        try {
            const deps = makeDeps({
                getConfiguration: () => ({ get: () => settingFile }),
                getEnv: () => envFile,
                which: () => '/usr/bin/v6asm',
            });
            expect(new V6asmLocator(deps).resolve()).to.equal(settingFile);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('should prefer env over PATH when setting is absent', () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v6asmtest-'));
        const envFile = path.join(tmpDir, 'env-v6asm');
        fs.writeFileSync(envFile, 'fake-env');
        try {
            const deps = makeDeps({
                getEnv: () => envFile,
                which: () => '/usr/bin/v6asm',
            });
            expect(new V6asmLocator(deps).resolve()).to.equal(envFile);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
