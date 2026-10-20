const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const stages = Object.freeze([
    { name: 'ci', args: ['run', 'ci'] },
    { name: 'test-typecheck', executable: 'typescript/bin/tsc', args: ['-p', 'tsconfig.test.json', '--noEmit'] },
    { name: 'package', args: ['run', 'package', '--', '--out', 'temp/language-presentation.vsix'] },
    { name: 'packaged-current', executable: './out/test/run-integration.js', args: ['--packaged'] },
    { name: 'packaged-minimum', executable: './out/test/run-integration.js', args: ['--packaged', '--minimum'] },
    { name: 'live-conformance', args: ['run', 'test:conformance'] },
]);

function validatePrerequisites(env = process.env) {
    if (!env.V6EMUL || !fs.existsSync(env.V6EMUL) || !fs.statSync(env.V6EMUL).isFile()) {
        throw new Error('Release verification requires V6EMUL pointing to a debugger-enabled emulator executable; live checks may not be skipped.');
    }
    if (!env.npm_execpath || !fs.existsSync(env.npm_execpath)) { throw new Error('Run release verification through npm run verify:release.'); }
}

function main() {
    const root = path.resolve(__dirname, '..');
    process.chdir(root);
    validatePrerequisites(); // Fail before deleting/building anything.
    fs.mkdirSync('temp', { recursive: true });
    fs.rmSync('out', { recursive: true, force: true }); // Deleted/moved modules must not leak into VSIX.
    const report = { startedAt: new Date().toISOString(), node: process.version, stages: [], success: false };
    const save = () => fs.writeFileSync('temp/release-verification.json', JSON.stringify(report, null, 2) + '\n');
    try {
        for (const stage of stages) {
            console.log(`\nRelease gate: ${stage.name}`);
            const executable = !stage.executable ? process.env.npm_execpath
                : stage.executable.startsWith('.') ? path.resolve(stage.executable) : require.resolve(stage.executable);
            const started = Date.now();
            const result = spawnSync(process.execPath, [executable, ...stage.args], { cwd: root, stdio: 'inherit',
                env: { ...process.env, V6_REQUIRE_LIVE: 'true' } });
            report.stages.push({ name: stage.name, exit: result.status, elapsedMs: Date.now() - started }); save();
            if (result.error || result.status !== 0) { throw result.error ?? new Error(`Release gate ${stage.name} failed (${result.status})`); }
        }
        report.success = true; report.finishedAt = new Date().toISOString(); save();
        console.log('All shipped/current/minimum/live release gates passed. No publication was performed.');
    } catch (error) { report.error = String(error); save(); throw error; }
}
module.exports = { stages, validatePrerequisites };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }