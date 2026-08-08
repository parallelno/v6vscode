import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
    expandTemplate,
    readTemplate,
    validateProjectName,
    getExecutablePath,
} from '../../src/templates/template-utils';
import { FddPersistence } from '../../src/emulator/persistence/fdd-persistence';

const EXTENSION_ROOT = path.resolve(__dirname, '..', '..');

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

describe('Commands and templates regression tests', () => {

    describe('Missing executable at run time', () => {
        it('should detect non-existent ROM file', () => {
            const execPath = path.join(os.tmpdir(), 'v6test_nonexistent_' + Date.now() + '.rom');
            expect(fs.existsSync(execPath)).to.be.false;
        });

        it('should detect non-existent FDD file', () => {
            const execPath = path.join(os.tmpdir(), 'v6test_nonexistent_' + Date.now() + '.fdd');
            expect(fs.existsSync(execPath)).to.be.false;
        });
    });

    describe('Project name validation edge cases', () => {
        it('should reject null bytes in name', () => {
            expect(validateProjectName('foo\x00bar')).to.be.a('string');
        });

        it('should reject control characters', () => {
            expect(validateProjectName('foo\x01bar')).to.be.a('string');
            expect(validateProjectName('foo\x1Fbar')).to.be.a('string');
        });

        it('should accept Unicode letters', () => {
            expect(validateProjectName('проект')).to.be.undefined;
        });

        it('should accept numbers and dots', () => {
            expect(validateProjectName('v1.0')).to.be.undefined;
        });

        it('should accept single character name', () => {
            expect(validateProjectName('a')).to.be.undefined;
        });
    });

    describe('Template file completeness', () => {
        it('all four Makefile templates should exist and be non-empty', () => {
            const variants = ['asm-rom', 'asm-fdd', 'c-rom', 'c-fdd'];
            for (const variant of variants) {
                const content = readTemplate(EXTENSION_ROOT, `makefiles/${variant}.Makefile.template`);
                expect(content.length, variant).to.be.greaterThan(0);
            }
        });

        it('project JSON template should produce valid JSON for any name', () => {
            const template = readTemplate(EXTENSION_ROOT, 'project/project.json.template');
            const names = ['demo', 'hello_world', 'test-project', 'v2'];
            for (const name of names) {
                const expanded = expandTemplate(template, {
                    name,
                    executable: getExecutablePath(name, 'rom'),
                });
                expect(() => JSON.parse(expanded), name).to.not.throw();
                const obj = JSON.parse(expanded);
                expect(obj.name).to.equal(name);
            }
        });

        it('FDD Makefile templates should contain v6fdd tool', () => {
            for (const lang of ['asm', 'c']) {
                const content = readTemplate(EXTENSION_ROOT, `makefiles/${lang}-fdd.Makefile.template`);
                expect(content, `${lang}-fdd`).to.include('v6fdd');
                expect(content, `${lang}-fdd`).to.include('TEMPLATE');
            }
        });

        it('C templates should contain v6c tool', () => {
            for (const execType of ['rom', 'fdd']) {
                const content = readTemplate(EXTENSION_ROOT, `makefiles/c-${execType}.Makefile.template`);
                expect(content, `c-${execType}`).to.include('v6c');
            }
        });
    });

    describe('FDD persistence: fddReadOnly=true skips entirely', () => {
        it('should not send any IPC commands when fddReadOnly is true', async () => {
            const logger = makeLogger();
            const sent: any[] = [];
            const client = {
                connected: true,
                send: async (cmd: number, data?: unknown) => {
                    sent.push({ cmd, data });
                    return { ok: true };
                },
            } as any;
            const svc = new FddPersistence(client, logger);

            await svc.persistIfNeeded(true, 'out/game.fdd');
            expect(sent).to.have.length(0);
        });
    });

    describe('FDD persistence: ROM executables skip FDD workflow', () => {
        it('should not attempt FDD persistence for .rom files', async () => {
            const logger = makeLogger();
            const sent: any[] = [];
            const client = {
                connected: true,
                send: async (cmd: number, data?: unknown) => {
                    sent.push({ cmd, data });
                    return { ok: true };
                },
            } as any;
            const svc = new FddPersistence(client, logger);

            await svc.persistIfNeeded(false, 'out/game.rom');
            expect(sent).to.have.length(0);
        });
    });

    describe('Multiple projects in workspace', () => {
        it('should create unique executable paths per project name', () => {
            const path1 = getExecutablePath('alpha', 'rom');
            const path2 = getExecutablePath('beta', 'rom');
            expect(path1).to.not.equal(path2);
            expect(path1).to.include('alpha');
            expect(path2).to.include('beta');
        });
    });

    describe('v6emul panel contributions', () => {
        it('contributes a supported launcher container without large debug sidebar views', () => {
            const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_ROOT, 'package.json'), 'utf8'));
            const contributes = manifest.contributes;
            expect(contributes.viewsContainers.activitybar).to.deep.include({
                id: 'v6emul', title: 'v6emul', icon: 'res/images/icon.png',
            });
            expect(contributes.views.v6emul).to.deep.include({ id: 'v6emul.panels', name: 'Panels' });
            expect(contributes.commands.filter((item: any) => item.category === 'v6emul').map((item: any) => item.command)).to.deep.equal([
                'v6emul.toggleSettings',
                'v6emul.toggleDisplay',
                'v6emul.toggleHexViewer',
                'v6emul.toggleMemoryEdits',
                'v6emul.togglePerformance',
                'v6emul.toggleTraceLog',
                'v6emul.toggleSymbols',
                'v6emul.togglePorts',
                'v6emul.toggleWatchpoints',
            ]);
            expect(contributes.menus['menubar/view']).to.equal(undefined);
            expect(contributes.views.debug.map((view: any) => view.id)).to.deep.equal(['v6.hardwareStatistics']);
        });
    });
});
