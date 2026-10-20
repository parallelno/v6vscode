import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

describe('Fail-closed release gate contract', () => {
    const script = createRequire(path.join(process.cwd(), 'package.json'))(path.join(process.cwd(), 'scripts/verify-release.cjs')) as {
        stages: Array<{ name: string; args: string[] }>; validatePrerequisites(env: Record<string, string>): void;
    };
    it('requires emulator and npm execution context rather than silently skipping live gates', () => {
        assert.throws(() => script.validatePrerequisites({}), /requires V6EMUL/);
        assert.throws(() => script.validatePrerequisites({ V6EMUL: process.execPath }), /through npm/);
        script.validatePrerequisites({ V6EMUL: process.execPath, npm_execpath: path.join(process.cwd(), 'package.json') });
    });
    it('runs shipped current/minimum and live conformance after CI/typecheck/package', () => {
        assert.deepStrictEqual(script.stages.map(stage => stage.name),
            ['ci', 'test-typecheck', 'package', 'packaged-current', 'packaged-minimum', 'live-conformance']);
        assert.ok(script.stages.find(stage => stage.name === 'packaged-minimum')!.args.includes('--minimum'));
        const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/release-verification.yml'), 'utf8');
        assert.ok(workflow.includes('npm run verify:release'));
        assert.ok(workflow.includes('self-hosted, Windows, X64, v6emul'));
        assert.ok(!workflow.includes('continue-on-error'));
    });
});