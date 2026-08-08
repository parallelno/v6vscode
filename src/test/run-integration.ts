import { createWriteStream, promises as fs } from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { runTests } from '@vscode/test-electron';

interface ZipEntry {
    fileName: string;
}

interface LazyZipFile {
    readEntry(): void;
    on(event: 'entry', listener: (entry: ZipEntry) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    openReadStream(
        entry: ZipEntry,
        callback: (error: Error | null, stream?: Readable) => void,
    ): void;
}

interface YauzlApi {
    open(
        file: string,
        options: { lazyEntries: boolean },
        callback: (error: Error | null, zip?: LazyZipFile) => void,
    ): void;
}

const yauzl = require('yauzl') as YauzlApi;

async function main(): Promise<void> {
    const extensionRoot = path.resolve(__dirname, '../..');
    const packaged = process.argv.includes('--packaged');
    const packagedRoot = path.join(extensionRoot, 'temp', 'packaged-extension');
    if (packaged) {
        await extractVsix(
            path.join(extensionRoot, 'temp', 'language-presentation.vsix'),
            packagedRoot,
        );
    }
    const extensionDevelopmentPath = packaged
        ? path.join(packagedRoot, 'extension')
        : extensionRoot;

    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath: path.join(extensionRoot, 'out', 'test', 'integration', 'index'),
        extensionTestsEnv: {
            V6_EXPECT_PACKAGED: packaged ? 'true' : 'false',
            V6_EXTENSION_ROOT: extensionRoot,
        },
    });
}

async function extractVsix(vsixPath: string, destination: string): Promise<void> {
    await fs.rm(destination, { recursive: true, force: true });
    await fs.mkdir(destination, { recursive: true });
    await new Promise<void>((resolve, reject) => {
        yauzl.open(vsixPath, { lazyEntries: true }, (openError, zip) => {
            if (openError || !zip) { reject(openError ?? new Error('Unable to open VSIX.')); return; }
            zip.on('error', reject);
            zip.on('end', resolve);
            zip.on('entry', entry => {
                const target = path.resolve(destination, entry.fileName);
                if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) {
                    reject(new Error(`Unsafe VSIX entry: ${entry.fileName}`));
                    return;
                }
                if (entry.fileName.endsWith('/')) {
                    void fs.mkdir(target, { recursive: true }).then(() => zip.readEntry(), reject);
                    return;
                }
                void fs.mkdir(path.dirname(target), { recursive: true })
                    .then(() => new Promise<void>((entryResolve, entryReject) => {
                        zip.openReadStream(entry, (streamError, stream) => {
                            if (streamError || !stream) {
                                entryReject(streamError ?? new Error(`Unable to read ${entry.fileName}.`));
                                return;
                            }
                            void pipeline(stream, createWriteStream(target)).then(entryResolve, entryReject);
                        });
                    }))
                    .then(() => zip.readEntry(), reject);
            });
            zip.readEntry();
        });
    });
}

void main().catch(error => {
    console.error(error);
    process.exit(1);
});