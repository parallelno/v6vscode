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
        getEnv: () => undefined,
        ...overrides,
    };
}

describe('V6emulLocator', () => {
    it('should use V6EMUL when it points to a file', () => {
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

    it('should reject an invalid V6EMUL path', () => {
        let warned = false;
        const deps = makeDeps({
            getEnv: () => '/nonexistent/v6emul',
            logger: { ...makeLogger(), warn: () => { warned = true; } },
        });
        expect(() => new V6emulLocator(deps).resolve())
            .to.throw(V6Error)
            .with.property('code', ErrorCode.EMULATOR_NOT_FOUND);
        expect(warned).to.be.true;
    });

    it('should throw EMULATOR_NOT_FOUND when V6EMUL is absent', () => {
        const deps = makeDeps();
        const locator = new V6emulLocator(deps);
        expect(() => locator.resolve()).to.throw(V6Error).with.property('code', ErrorCode.EMULATOR_NOT_FOUND);
    });
});
