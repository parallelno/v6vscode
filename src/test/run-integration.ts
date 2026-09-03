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
    const integrationWorkspace = path.join(extensionRoot, 'temp', 'integration-debug-workspace');
    await prepareIntegrationWorkspace(extensionRoot, integrationWorkspace);
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
            V6_DEBUG_INTEGRATION_WORKSPACE: integrationWorkspace,
        },
        launchArgs: [integrationWorkspace],
    });
}

async function prepareIntegrationWorkspace(extensionRoot: string, workspace: string): Promise<void> {
    const probeRoot = path.join(extensionRoot, 'temp', 'cdbg');
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, 'cdbg.project.json'), JSON.stringify({
        name: 'cdbg-integration',
        run: {
            executable: path.join(probeRoot, 'probe-O0.rom'),
            debugArtifact: path.join(probeRoot, 'probe-O0.elf'),
            loadAddr: '0x100',
            speed: 'max',
        },
    }, null, 2));
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