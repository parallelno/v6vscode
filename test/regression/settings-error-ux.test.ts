import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
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

    describe('V6EMUL validation', () => {
        it('should warn and fail when V6EMUL does not exist', () => {
            const logger = makeLogger();
            const deps: V6emulLocatorDeps = {
                logger,
                getEnv: () => '/nonexistent/fake/v6emul',
            };
            const locator = new V6emulLocator(deps);
            expect(() => locator.resolve()).to.throw(V6Error);
            const warnLogs = logger.logs.filter((l: string) => l.startsWith('warn:'));
            expect(warnLogs.some((l: string) => l.includes('does not exist'))).to.be.true;
        });

        it('should fail without warning when V6EMUL is absent', () => {
            const logger = makeLogger();
            const deps: V6emulLocatorDeps = {
                logger,
                getEnv: () => undefined,
            };
            const locator = new V6emulLocator(deps);
            expect(() => locator.resolve()).to.throw(V6Error);
            const warnLogs = logger.logs.filter((l: string) => l.startsWith('warn:'));
            expect(warnLogs.some((l: string) => l.includes('does not exist'))).to.be.false;
        });

        it('should use V6EMUL when the file exists', () => {
            const logger = makeLogger();
            // Use package.json as a stand-in for an existing file
            const existingFile = path.join(EXTENSION_ROOT, 'package.json');
            const deps: V6emulLocatorDeps = {
                logger,
                getEnv: () => existingFile,
            };
            const locator = new V6emulLocator(deps);
            const result = locator.resolve();
            expect(result).to.equal(existingFile);
        });
    });

    describe('Error codes produce actionable messages', () => {
        it('EMULATOR_NOT_FOUND message should require V6EMUL', () => {
            const err = new V6Error(
                ErrorCode.EMULATOR_NOT_FOUND,
                'Could not locate v6emul. Set V6EMUL to the full path of the v6emul executable.',
            );
            expect(err.message).to.include('V6EMUL');
            expect(err.message).not.to.include('PATH');
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
        it('should not contribute executable path settings', () => {
            const packageJsonPath = path.join(EXTENSION_ROOT, 'package.json');
            const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
            const properties = pkg.contributes.configuration.properties;
            expect(properties).not.to.have.property('v6.emulatorPath');
            expect(properties).not.to.have.property('v6.assemblerPath');
            expect(properties).not.to.have.property('v6.fddToolPath');
        });

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
