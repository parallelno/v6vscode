import * as path from 'path';
import Mocha from 'mocha';

export async function run(): Promise<void> {
    const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 15_000 });
    mocha.addFile(path.resolve(__dirname, 'suite', 'extension-startup.test.js'));

    await new Promise<void>((resolve, reject) => {
        mocha.run(failures => {
            if (failures === 0) {
                resolve();
            } else {
                reject(new Error(`${failures} integration test(s) failed.`));
            }
        });
    });
}