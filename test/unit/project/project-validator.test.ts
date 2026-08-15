import { expect } from 'chai';
import { validate, ValidationResult } from '../../../src/project/validation/project-validator';

describe('project-validator', () => {
    describe('accept cases', () => {
        it('should accept minimal valid project', () => {
            const result = validate({ name: 'test', run: { executable: 'a.rom' } });
            expect(result.ok).to.be.true;
        });

        it('should accept all-fields project', () => {
            const result = validate({
                name: 'full',
                run: {
                    executable: 'game.rom',
                    debugArtifact: 'game.elf',
                    bootRom: 'boot.bin',
                    loadAddr: '0x200',
                    fddReadOnly: true,
                    speed: '200%',
                    viewMode: 'border',
                },
            });
            expect(result.ok).to.be.true;
            if (result.ok) {
                expect(result.name).to.equal('full');
                expect(result.run.executable).to.equal('game.rom');
                expect(result.run.debugArtifact).to.equal('game.elf');
                expect(result.run.bootRom).to.equal('boot.bin');
                expect(result.run.loadAddr).to.equal('0x200');
                expect(result.run.fddReadOnly).to.equal(true);
                expect(result.run.speed).to.equal('200%');
                expect(result.run.viewMode).to.equal('border');
            }
        });

        it('should apply defaults for missing optional fields', () => {
            const result = validate({ name: 'test', run: { executable: 'a.rom' } });
            expect(result.ok).to.be.true;
            if (result.ok) {
                expect(result.run.loadAddr).to.equal('0x100');
                expect(result.run.fddReadOnly).to.equal(false);
                expect(result.run.speed).to.equal('100%');
                expect(result.run.viewMode).to.equal('borderless');
                expect(result.run.debugArtifact).to.be.undefined;
                expect(result.run.bootRom).to.be.undefined;
            }
        });

        it('should accept all valid viewMode values', () => {
            for (const mode of ['borderless', 'border', 'full']) {
                const result = validate({ name: 'test', run: { executable: 'a.rom', viewMode: mode } });
                expect(result.ok, `viewMode "${mode}" should be accepted`).to.be.true;
            }
        });
    });

    describe('reject cases', () => {
        it('should reject non-object root', () => {
            expect(validate('string').ok).to.be.false;
            expect(validate(null).ok).to.be.false;
            expect(validate(42).ok).to.be.false;
            expect(validate([]).ok).to.be.false;
        });

        it('should reject missing name', () => {
            const result = validate({ run: { executable: 'a.rom' } });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'name')).to.be.true;
            }
        });

        it('should reject missing run', () => {
            const result = validate({ name: 'test' });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'run')).to.be.true;
            }
        });

        it('should reject missing run.executable', () => {
            const result = validate({ name: 'test', run: {} });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'run.executable')).to.be.true;
            }
        });

        it('should reject non-string name', () => {
            const result = validate({ name: 123, run: { executable: 'a.rom' } });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'name' && e.message.includes('string'))).to.be.true;
            }
        });

        it('should reject empty name', () => {
            const result = validate({ name: '', run: { executable: 'a.rom' } });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'name' && e.message.includes('empty'))).to.be.true;
            }
        });

        it('should reject empty executable', () => {
            const result = validate({ name: 'test', run: { executable: '' } });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'run.executable' && e.message.includes('empty'))).to.be.true;
            }
        });

        it('should reject non-string executable', () => {
            const result = validate({ name: 'test', run: { executable: true } });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'run.executable')).to.be.true;
            }
        });

        it('should reject an empty debug artifact path', () => {
            const result = validate({ name: 'test', run: { executable: 'a.rom', debugArtifact: '' } });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'run.debugArtifact')).to.be.true;
            }
        });

        it('should reject invalid viewMode', () => {
            const result = validate({ name: 'test', run: { executable: 'a.rom', viewMode: 'invalid' } });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'run.viewMode')).to.be.true;
            }
        });

        it('should reject non-boolean fddReadOnly', () => {
            const result = validate({ name: 'test', run: { executable: 'a.rom', fddReadOnly: 'yes' } });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'run.fddReadOnly')).to.be.true;
            }
        });

        it('should reject non-object run', () => {
            const result = validate({ name: 'test', run: 'string' });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'run')).to.be.true;
            }
        });

        it('should reject array as run', () => {
            const result = validate({ name: 'test', run: [] });
            expect(result.ok).to.be.false;
        });

        it('should report unknown top-level keys', () => {
            const result = validate({ name: 'test', run: { executable: 'a.rom' }, extra: true });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'extra')).to.be.true;
            }
        });

        it('should report unknown run keys', () => {
            const result = validate({ name: 'test', run: { executable: 'a.rom', unknown: 1 } });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.some(e => e.path === 'run.unknown')).to.be.true;
            }
        });

        it('should collect multiple errors at once', () => {
            const result = validate({ extra: true });
            expect(result.ok).to.be.false;
            if (!result.ok) {
                expect(result.errors.length).to.be.greaterThan(1);
            }
        });
    });
});
