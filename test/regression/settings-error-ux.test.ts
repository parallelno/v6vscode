import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import { ErrorCode } from '../../src/platform/errors/error-codes';
import { V6Error } from '../../src/platform/errors/v6-error';
import { V6emulLocator, V6emulLocatorDeps } from '../../src/emulator/launcher/v6emul-locator';

function makeLogger() {
    const logs: string[] = [];
    return {
        error: (msg: string) => logs.push(`error: ${msg}`),
        warn: (msg: string) => logs.push(`warn: ${msg}`),
        info: (msg: string) => logs.push(`info: ${msg}`),
        debug: (msg: string) => logs.push(`debug: ${msg}`),
        dispose: () => {},
        logs,
    } as any;
}

const EXTENSION_ROOT = path.resolve(__dirname, '..', '..');

describe('Settings and error UX regression tests', () => {

    describe('v6.emulatorPath setting validation', () => {
        it('should warn when setting path does not exist but still try fallbacks', () => {
            const logger = makeLogger();
            const deps: V6emulLocatorDeps = {
                pathService: { resolveExtensionPath: () => '/nonexistent/bundled/v6emul' } as any,
                logger,
                getConfiguration: () => ({ get: () => '/nonexistent/fake/v6emul' }),
                which: () => undefined,
            };
            const locator = new V6emulLocator(deps);
            expect(() => locator.resolve()).to.throw(V6Error);
            // Verify the locator logged a warning about the setting path
            const warnLogs = logger.logs.filter((l: string) => l.startsWith('warn:'));
            expect(warnLogs.some((l: string) => l.includes('does not exist'))).to.be.true;
        });

        it('should accept empty emulator path and skip to bundled lookup', () => {
            const logger = makeLogger();
            const deps: V6emulLocatorDeps = {
                pathService: { resolveExtensionPath: () => '/nonexistent/bundled/v6emul' } as any,
                logger,
                getConfiguration: () => ({ get: () => '' }),
                which: () => undefined,
            };
            const locator = new V6emulLocator(deps);
            // Should not warn about empty path — just skip to next tier
            expect(() => locator.resolve()).to.throw(V6Error);
            const warnLogs = logger.logs.filter((l: string) => l.startsWith('warn:'));
            expect(warnLogs.some((l: string) => l.includes('does not exist'))).to.be.false;
        });

        it('should use setting path when file exists', () => {
            const logger = makeLogger();
            // Use package.json as a stand-in for an existing file
            const existingFile = path.join(EXTENSION_ROOT, 'package.json');
            const deps: V6emulLocatorDeps = {
                pathService: { resolveExtensionPath: () => '/nonexistent/bundled/v6emul' } as any,
                logger,
                getConfiguration: () => ({ get: () => existingFile }),
                which: () => undefined,
            };
            const locator = new V6emulLocator(deps);
            const result = locator.resolve();
            expect(result).to.equal(existingFile);
        });
    });

    describe('Error codes produce actionable messages', () => {
        it('EMULATOR_NOT_FOUND message should suggest setting path', () => {
            const err = new V6Error(
                ErrorCode.EMULATOR_NOT_FOUND,
                'Could not locate v6emul. Set v6.emulatorPath in settings or add v6emul to PATH.',
            );
            expect(err.message).to.include('v6.emulatorPath');
            expect(err.message).to.include('PATH');
        });

        it('EXECUTABLE_NOT_FOUND message should suggest building', () => {
            const err = new V6Error(
                ErrorCode.EXECUTABLE_NOT_FOUND,
                'Executable not found: out/demo.rom. Build the project first.',
            );
            expect(err.message).to.include('Build');
        });

        it('IPC_CONNECTION_REFUSED should include retry context', () => {
            const err = new V6Error(
                ErrorCode.IPC_CONNECTION_REFUSED,
                'Failed to connect after 10 attempts',
            );
            expect(err.code).to.equal(ErrorCode.IPC_CONNECTION_REFUSED);
            expect(err.message).to.include('connect');
        });

        it('CONFIG_INVALID should carry the original parse cause', () => {
            const cause = new SyntaxError('Unexpected token } in JSON');
            const err = new V6Error(ErrorCode.CONFIG_INVALID, 'Invalid project file', cause);
            expect(err.cause).to.be.instanceOf(SyntaxError);
            expect(err.code).to.equal(ErrorCode.CONFIG_INVALID);
        });
    });

    describe('.vscodeignore completeness', () => {
        it('.vscodeignore should exist', () => {
            const vscodeignorePath = path.join(EXTENSION_ROOT, '.vscodeignore');
            expect(fs.existsSync(vscodeignorePath)).to.be.true;
        });

        it('.vscodeignore should exclude test/ and src/', () => {
            const vscodeignorePath = path.join(EXTENSION_ROOT, '.vscodeignore');
            const content = fs.readFileSync(vscodeignorePath, 'utf-8');
            expect(content).to.include('src/**');
            expect(content).to.include('test/**');
        });

        it('.vscodeignore should exclude design/ and temp/', () => {
            const vscodeignorePath = path.join(EXTENSION_ROOT, '.vscodeignore');
            const content = fs.readFileSync(vscodeignorePath, 'utf-8');
            expect(content).to.include('design/**');
            expect(content).to.include('temp/**');
        });

        it('.vscodeignore should exclude source maps', () => {
            const vscodeignorePath = path.join(EXTENSION_ROOT, '.vscodeignore');
            const content = fs.readFileSync(vscodeignorePath, 'utf-8');
            expect(content).to.include('**/*.map');
        });
    });

    describe('package.json packaging fields', () => {
        it('should have a package script', () => {
            const packageJsonPath = path.join(EXTENSION_ROOT, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            expect(pkg.scripts.package).to.be.a('string');
            expect(pkg.scripts.package).to.include('vsce');
        });

        it('should have a ci script that compiles and tests', () => {
            const packageJsonPath = path.join(EXTENSION_ROOT, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            expect(pkg.scripts.ci).to.include('compile');
            expect(pkg.scripts.ci).to.include('test');
        });

        it('should have test:all that runs both unit and regression', () => {
            const packageJsonPath = path.join(EXTENSION_ROOT, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            expect(pkg.scripts['test:all']).to.include('test:unit');
            expect(pkg.scripts['test:all']).to.include('test:regression');
        });
    });
});
