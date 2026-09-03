import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import {
    expandTemplate,
    readTemplate,
    getMakefileTemplatePath,
    getSourceTemplatePath,
    getSourceFileName,
    getExecutablePath,
    validateProjectName,
} from '../../../src/templates/template-utils';

const EXTENSION_ROOT = process.cwd();

describe('template-utils', () => {
    describe('expandTemplate', () => {
        it('should replace {{name}} placeholder', () => {
            const result = expandTemplate('Hello {{name}}!', { name: 'world' });
            expect(result).to.equal('Hello world!');
        });

        it('should replace multiple placeholders', () => {
            const result = expandTemplate('{{a}} + {{b}} = {{c}}', { a: '1', b: '2', c: '3' });
            expect(result).to.equal('1 + 2 = 3');
        });

        it('should leave unmatched placeholders intact', () => {
            const result = expandTemplate('{{known}} {{unknown}}', { known: 'yes' });
            expect(result).to.equal('yes {{unknown}}');
        });

        it('should handle empty vars', () => {
            const result = expandTemplate('no vars here', {});
            expect(result).to.equal('no vars here');
        });

        it('should replace same placeholder multiple times', () => {
            const result = expandTemplate('{{x}} and {{x}}', { x: 'hi' });
            expect(result).to.equal('hi and hi');
        });
    });

    describe('validateProjectName', () => {
        it('should accept valid name', () => {
            expect(validateProjectName('demo')).to.be.undefined;
        });

        it('should accept name with underscores and hyphens', () => {
            expect(validateProjectName('my-project_v2')).to.be.undefined;
        });

        it('should reject empty string', () => {
            expect(validateProjectName('')).to.be.a('string');
        });

        it('should reject whitespace-only string', () => {
            expect(validateProjectName('   ')).to.be.a('string');
        });

        it('should reject name with path separator', () => {
            expect(validateProjectName('foo/bar')).to.be.a('string');
            expect(validateProjectName('foo\\bar')).to.be.a('string');
        });

        it('should reject name with special characters', () => {
            expect(validateProjectName('foo<bar')).to.be.a('string');
            expect(validateProjectName('foo>bar')).to.be.a('string');
            expect(validateProjectName('foo:bar')).to.be.a('string');
            expect(validateProjectName('foo"bar')).to.be.a('string');
            expect(validateProjectName('foo|bar')).to.be.a('string');
            expect(validateProjectName('foo?bar')).to.be.a('string');
            expect(validateProjectName('foo*bar')).to.be.a('string');
        });

        it('should reject name longer than 100 characters', () => {
            expect(validateProjectName('a'.repeat(101))).to.be.a('string');
        });

        it('should accept name exactly 100 characters', () => {
            expect(validateProjectName('a'.repeat(100))).to.be.undefined;
        });
    });

    describe('getMakefileTemplatePath', () => {
        it('should return asm-rom path', () => {
            expect(getMakefileTemplatePath('asm', 'rom')).to.equal('makefiles/asm-rom.Makefile.template');
        });

        it('should return asm-fdd path', () => {
            expect(getMakefileTemplatePath('asm', 'fdd')).to.equal('makefiles/asm-fdd.Makefile.template');
        });

        it('should return c-rom path', () => {
            expect(getMakefileTemplatePath('c', 'rom')).to.equal('makefiles/c-rom.Makefile.template');
        });

        it('should return c-fdd path', () => {
            expect(getMakefileTemplatePath('c', 'fdd')).to.equal('makefiles/c-fdd.Makefile.template');
        });
    });

    describe('getSourceTemplatePath', () => {
        it('should return asm template path', () => {
            expect(getSourceTemplatePath('asm')).to.equal('asm/main.asm.template');
        });

        it('should return c template path', () => {
            expect(getSourceTemplatePath('c')).to.equal('c/main.c.template');
        });
    });

    describe('getSourceFileName', () => {
        it('should return main.asm for asm', () => {
            expect(getSourceFileName('asm')).to.equal('main.asm');
        });

        it('should return main.c for c', () => {
            expect(getSourceFileName('c')).to.equal('main.c');
        });
    });

    describe('getExecutablePath', () => {
        it('should return ROM path', () => {
            expect(getExecutablePath('demo', 'rom')).to.equal('out/demo.rom');
        });

        it('should return FDD path', () => {
            expect(getExecutablePath('demo', 'fdd')).to.equal('out/demo.fdd');
        });
    });

    describe('readTemplate', () => {
        it('should read project JSON template', () => {
            const content = readTemplate(EXTENSION_ROOT, 'project/project.json.template');
            expect(content).to.include('{{name}}');
            expect(content).to.include('{{executable}}');
        });

        it('should read all four Makefile templates', () => {
            const variants = ['asm-rom', 'asm-fdd', 'c-rom', 'c-fdd'];
            for (const variant of variants) {
                const content = readTemplate(EXTENSION_ROOT, `makefiles/${variant}.Makefile.template`);
                expect(content, variant).to.include('{{name}}');
                expect(content, variant).to.include('v6asm');
            }
        });

        it('should read ASM source template', () => {
            const content = readTemplate(EXTENSION_ROOT, 'asm/main.asm.template');
            expect(content).to.include('{{name}}');
            expect(content).to.include('.org');
        });

        it('should read C source template', () => {
            const content = readTemplate(EXTENSION_ROOT, 'c/main.c.template');
            expect(content).to.include('{{name}}');
            expect(content).to.include('void main');
        });
    });

    describe('template expansion integration', () => {
        it('should produce valid JSON when expanding project template', () => {
            const template = readTemplate(EXTENSION_ROOT, 'project/project.json.template');
            const expanded = expandTemplate(template, { name: 'test', executable: 'out/test.rom' });
            const parsed = JSON.parse(expanded);
            expect(parsed.name).to.equal('test');
            expect(parsed.run.executable).to.equal('out/test.rom');
            expect(parsed.run.speed).to.equal('100%');
            expect(parsed.run.viewMode).to.equal('borderless');
        });

        it('should produce valid Makefile content for asm-rom', () => {
            const template = readTemplate(EXTENSION_ROOT, 'makefiles/asm-rom.Makefile.template');
            const expanded = expandTemplate(template, { name: 'hello' });
            expect(expanded).to.include('out/hello.rom');
            expect(expanded).to.include('v6asm');
            expect(expanded).to.include('clean:');
        });

        it('should produce valid Makefile content for c-fdd', () => {
            const template = readTemplate(EXTENSION_ROOT, 'makefiles/c-fdd.Makefile.template');
            const expanded = expandTemplate(template, { name: 'game' });
            expect(expanded).to.include('out/game.rom');
            expect(expanded).to.include('out/game.fdd');
            expect(expanded).to.include('v6c');
            expect(expanded).to.include('v6asm');
            expect(expanded).to.include('v6fdd');
        });
    });
});
