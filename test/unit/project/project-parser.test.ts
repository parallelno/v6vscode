import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from '../../../src/project/parsing/project-parser';
import { V6Error } from '../../../src/platform/errors/v6-error';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures', 'projects');

function readFixture(name: string): string {
    return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

describe('project-parser', () => {
    it('should parse valid minimal JSON', () => {
        const result = parse(readFixture('minimal-valid.project.json'));
        expect(result).to.deep.equal({
            name: 'minimal',
            run: { executable: 'build/out.rom' },
        });
    });

    it('should parse all-fields JSON', () => {
        const result = parse(readFixture('all-fields.project.json')) as any;
        expect(result.name).to.equal('full-project');
        expect(result.run.executable).to.equal('build/game.rom');
        expect(result.run.bootRom).to.equal('res/boot.bin');
        expect(result.run.loadAddr).to.equal('0x200');
        expect(result.run.fddReadOnly).to.equal(true);
        expect(result.run.speed).to.equal('200%');
        expect(result.run.viewMode).to.equal('border');
    });

    it('should round-trip through JSON.stringify and parse', () => {
        const original = { name: 'test', run: { executable: 'a.rom', speed: '50%' } };
        const text = JSON.stringify(original);
        const parsed = parse(text);
        expect(parsed).to.deep.equal(original);
    });

    it('should throw V6Error on invalid JSON', () => {
        expect(() => parse('{ not valid json')).to.throw(V6Error);
    });

    it('should throw V6Error with CONFIG_INVALID code', () => {
        try {
            parse('{{');
            expect.fail('should have thrown');
        } catch (err) {
            expect(err).to.be.instanceOf(V6Error);
            expect((err as V6Error).code).to.equal('CONFIG_INVALID');
        }
    });

    it('should preserve the underlying cause', () => {
        try {
            parse('{]');
            expect.fail('should have thrown');
        } catch (err) {
            expect((err as V6Error).cause).to.be.instanceOf(SyntaxError);
        }
    });
});
