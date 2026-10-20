import * as path from 'path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 15_000 });
    mocha.addFile(path.resolve(__dirname, 'suite', 'extension-startup.test.js'));
    mocha.addFile(path.resolve(__dirname, 'suite', 'c-source-breakpoint.test.js'));

    mocha.addFile(path.resolve(__dirname, 'suite', 'asm-value-presentation.test.js'));
    mocha.addFile(path.resolve(__dirname, 'suite', 'source-paths.test.js'));

    await new Promise<void>((resolve, reject) => {
        const runner = mocha.run(failures => {
            if (process.env.V6_REQUIRE_LIVE === 'true' && runner.stats?.pending) {
                reject(new Error(`Release integration cannot skip ${runner.stats.pending} test(s). Check V6EMUL.`));
                return;
            }
            if (failures === 0) {
                resolve();
            } else {
                reject(new Error(`${failures} integration test(s) failed.`));
            }
        });
    });
}