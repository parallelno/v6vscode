import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from '../../src/project/parsing/project-parser';
import { validate } from '../../src/project/validation/project-validator';
import { V6Error } from '../../src/platform/errors/v6-error';

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'projects');

function loadAndValidate(filename: string) {
    const text = fs.readFileSync(path.join(FIXTURES, filename), 'utf-8');
    const data = parse(text);
    return validate(data);
}

describe('Regression: project system', () => {
    it('should reject project file with missing required fields (missing name)', () => {
        const result = loadAndValidate('missing-name.project.json');
        expect(result.ok).to.be.false;
        if (!result.ok) {
            expect(result.errors.some(e => e.path === 'name')).to.be.true;
        }
    });

    it('should reject project file with missing run', () => {
        const result = loadAndValidate('missing-run.project.json');
        expect(result.ok).to.be.false;
        if (!result.ok) {
            expect(result.errors.some(e => e.path === 'run')).to.be.true;
        }
    });

    it('should reject project file with missing executable', () => {
        const result = loadAndValidate('missing-executable.project.json');
        expect(result.ok).to.be.false;
        if (!result.ok) {
            expect(result.errors.some(e => e.path === 'run.executable')).to.be.true;
        }
    });

    it('should reject project file with invalid types', () => {
        const result = loadAndValidate('invalid-types.project.json');
        expect(result.ok).to.be.false;
        if (!result.ok) {
            expect(result.errors.length).to.be.greaterThanOrEqual(2);
        }
    });

    it('should reject project file with unknown keys', () => {
        const result = loadAndValidate('unknown-keys.project.json');
        expect(result.ok).to.be.false;
        if (!result.ok) {
            expect(result.errors.some(e => e.path === 'extra')).to.be.true;
        }
    });

    it('should accept and apply defaults to minimal valid project', () => {
        const result = loadAndValidate('minimal-valid.project.json');
        expect(result.ok).to.be.true;
        if (result.ok) {
            expect(result.name).to.equal('minimal');
            expect(result.run.executable).to.equal('build/out.rom');
            expect(result.run.loadAddr).to.equal('0x100');
            expect(result.run.fddReadOnly).to.equal(false);
            expect(result.run.speed).to.equal('100%');
            expect(result.run.viewMode).to.equal('borderless');
        }
    });

    it('should accept and preserve all-fields project', () => {
        const result = loadAndValidate('all-fields.project.json');
        expect(result.ok).to.be.true;
        if (result.ok) {
            expect(result.name).to.equal('full-project');
            expect(result.run.debugArtifact).to.equal('build/game.elf');
            expect(result.run.viewMode).to.equal('border');
            expect(result.run.fddReadOnly).to.equal(true);
        }
    });

    it('should throw V6Error for completely broken JSON', () => {
        expect(() => parse('not json at all')).to.throw(V6Error);
    });
});
