const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yauzl = require('yauzl');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'temp', 'publish-report.json');
const marketplaceItem = 'https://marketplace.visualstudio.com/items?itemName=';
let activeReport;

const usage = `Usage: node scripts/publish.cjs [options]

Verifies, packages and (only with --publish) publishes the extension to the
VS Code Marketplace. Without --publish this is a dry run: nothing is published,
no version is bumped, and no commit, tag or push is created.

Options:
  --publish            Publish the validated VSIX. Requires VSCE_PAT.
  --dry-run            Explicit dry run (default when --publish is absent).
  --pre-release        Mark the VSIX as a pre-release (package and publish).
  --verify             Run the full "npm run verify:release" gate in a dry run.
  --skip-verify        Skip verification. Publishing then prints an explicit warning.
  --allow-dirty        Allow an unclean Git working tree (not recommended).
  --out <directory>    Package output directory (default: temp/publish).
  -h, --help           Show this help.

Environment:
  VSCE_PAT             Marketplace personal access token (only needed to publish).
  V6EMUL               Debugger-enabled emulator executable (needed by verify:release).
`;

function parseArgs(argv) {
    const options = {
        publish: false,
        dryRun: false,
        preRelease: false,
        verify: false,
        skipVerify: false,
        allowDirty: false,
        out: path.join('temp', 'publish'),
        help: false,
    };
    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        switch (argument) {
            case '--publish': options.publish = true; break;
            case '--dry-run': options.dryRun = true; break;
            case '--pre-release': options.preRelease = true; break;
            case '--verify': options.verify = true; break;
            case '--skip-verify': options.skipVerify = true; break;
            case '--allow-dirty': options.allowDirty = true; break;
            case '--out': {
                const value = argv[++index];
                if (!value) { throw new Error('--out requires a directory.'); }
                options.out = value;
                break;
            }
            case '-h':
            case '--help': options.help = true; break;
            default: throw new Error(`Unknown option: ${argument}\n\n${usage}`);
        }
    }
    if (options.publish && options.dryRun) { throw new Error('--publish and --dry-run cannot be combined.'); }
    if (options.verify && options.skipVerify) { throw new Error('--verify and --skip-verify cannot be combined.'); }
    return options;
}

function saveReport(report) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}

function resolveNpmCli() {
    if (process.env.npm_execpath && fs.existsSync(process.env.npm_execpath)) { return process.env.npm_execpath; }
    const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (fs.existsSync(bundled)) { return bundled; }
    throw new Error('Unable to locate the npm CLI. Run this script through npm (npm run publish:dry-run).');
}

function resolveVsceEntry() {
    const packagePath = require.resolve('@vscode/vsce/package.json');
    return path.join(path.dirname(packagePath), 'vsce');
}

function runStage(report, name, args, extraEnv = {}) {
    console.log(`\nPublish gate: ${name}`);
    const started = Date.now();
    const result = spawnSync(process.execPath, args, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, ...extraEnv },
    });
    report.stages.push({ name, exit: result.error ? null : result.status, elapsedMs: Date.now() - started });
    saveReport(report);
    if (result.error) { throw result.error; }
    if (result.status !== 0) { throw new Error(`Publish gate ${name} failed (${result.status}).`); }
}

function gitOutput(args) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.error || result.status !== 0) { return undefined; }
    return result.stdout.trim();
}

function validatePreflight(options, manifest) {
    const failures = [];
    for (const field of ['name', 'displayName', 'description', 'version', 'publisher', 'license']) {
        if (!manifest[field]) { failures.push(`package.json is missing "${field}".`); }
    }
    if (!manifest.repository || !manifest.repository.url) { failures.push('package.json is missing a repository URL.'); }
    if (!manifest.engines || !manifest.engines.vscode) { failures.push('package.json is missing "engines.vscode".'); }
    if (!manifest.main) { failures.push('package.json is missing "main".'); }
    if (!fs.existsSync(path.join(root, 'README.md'))) { failures.push('README.md is missing; the Marketplace requires it.'); }
    if (!fs.existsSync(path.join(root, 'LICENSE'))) { failures.push('LICENSE is missing; the Marketplace requires a license file.'); }
    // The Marketplace rejects semver prerelease versions; --pre-release is the supported flag.
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
        failures.push(`package.json version "${manifest.version}" must be a plain x.y.z version; the Marketplace rejects semver prerelease versions. Use --pre-release instead.`);
    }
    if ((manifest.activationEvents || []).includes('*')) {
        failures.push('package.json uses the "*" activation event, which the Marketplace rejects.');
    }

    const insideWorkspace = gitOutput(['rev-parse', '--is-inside-work-tree']);
    if (insideWorkspace !== 'true') {
        failures.push('This directory is not a Git working tree, so the package cannot be tied to a commit.');
    } else {
        if (!options.allowDirty && gitOutput(['status', '--porcelain'])) {
            failures.push('The Git working tree is dirty. Commit or stash changes (or pass --allow-dirty to override).');
        }
        const branch = gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']);
        if (branch && branch !== 'main') { console.warn(`Warning: publishing from branch "${branch}", not "main".`); }
        if (options.publish && !gitOutput(['describe', '--exact-match', '--tags', 'HEAD'])) {
            console.warn('Warning: HEAD is not tagged. Consider tagging the verified release commit.');
        }
    }
    if (options.publish && !options.skipVerify && (!process.env.V6EMUL || !fs.existsSync(process.env.V6EMUL))) {
        failures.push('Publishing requires V6EMUL pointing to a debugger-enabled emulator for verify:release. Use --skip-verify only for an intentional hotfix.');
    }
    if (options.publish && !process.env.VSCE_PAT) {
        failures.push('Publishing requires the VSCE_PAT environment variable (Marketplace personal access token). Do not pass tokens on the command line.');
    }
    if (failures.length) { throw new Error(failures.join('\n')); }
}

function readZipEntries(vsixPath) {
    return new Promise((resolve, reject) => {
        yauzl.open(vsixPath, { lazyEntries: true }, (openError, zip) => {
            if (openError || !zip) { reject(openError || new Error('Unable to open the VSIX.')); return; }
            const entries = new Map();
            zip.on('error', reject);
            zip.on('end', () => resolve(entries));
            zip.on('entry', entry => {
                if (entry.fileName.endsWith('/')) { entries.set(entry.fileName, null); zip.readEntry(); return; }
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError || !stream) {
                        reject(streamError || new Error(`Unable to read ${entry.fileName}.`));
                        return;
                    }
                    const chunks = [];
                    stream.on('data', chunk => chunks.push(chunk));
                    stream.on('error', reject);
                    stream.on('end', () => {
                        entries.set(entry.fileName, Buffer.concat(chunks));
                        zip.readEntry();
                    });
                });
            });
            zip.readEntry();
        });
    });
}

// vsce normalizes README/LICENSE to these names inside the VSIX.
const requiredEntries = Object.freeze([
    'extension/package.json',
    'extension/readme.md',
    'extension/LICENSE.txt',
    'extension/language-configuration.json',
    'extension/out/extension.js',
    'extension/config/schemas/v6.project.schema.json',
    'extension/res/syntaxes/v6vscode_8080.tmLanguage.json',
    'extension/images/icon2.png',
    'extension/res/images/icon.png',
    'extension/res/images/reload-rom.svg',
    'extension/res/boot/boot.bin',
    'extension/res/boot/boots.bin',
    'extension/res/boot/boot.txt',
    'extension/res/boot/boots.txt',
    'extension/res/fdd/rds308.fdd',
    // .vscodeignore negations intentionally ship these webview assets.
    'extension/src/emulator/panel/assets/panel.js',
    'extension/src/debug/views/assets/scripts.js',
]);

const forbiddenPrefixes = Object.freeze([
    'extension/src/',
    'extension/test/',
    'extension/docs/',
    'extension/design/',
    'extension/scripts/',
    'extension/temp/',
    'extension/out/test/',
    'extension/.github/',
    'extension/.vscode-test/',
    'extension/.devcontainer/',
    'extension/.vscode/',
]);

// The only src/ files allowed to ship are the webview assets kept by .vscodeignore.
const shippedSourcePrefixes = Object.freeze([
    'extension/src/emulator/panel/assets/',
    'extension/src/debug/views/assets/',
]);

const allowedTopLevelEntries = Object.freeze([
    '[Content_Types].xml',
    'extension.vsixmanifest',
]);

async function validateVsix(vsixPath, manifest, options) {
    const entries = await readZipEntries(vsixPath);
    const failures = [];
    for (const required of requiredEntries) {
        if (!entries.has(required)) { failures.push(`The VSIX is missing ${required}.`); }
    }
    for (const [entry, content] of entries) {
        if (content === null) { continue; }
        const shippedSource = entry.startsWith('extension/src/')
            && shippedSourcePrefixes.some(prefix => entry.startsWith(prefix));
        if (forbiddenPrefixes.some(prefix => entry.startsWith(prefix)) && !shippedSource) {
            failures.push(`The VSIX contains development-only entry ${entry}.`);
        }
        if (entry.endsWith('.map') || entry.endsWith('.log')) {
            failures.push(`The VSIX contains build artifact ${entry}.`);
        }
        if (!entry.startsWith('extension/') && !allowedTopLevelEntries.includes(entry)) {
            failures.push(`The VSIX contains an unexpected top-level entry ${entry}.`);
        }
    }
    if (failures.length) { throw new Error(failures.join('\n')); }

    const packaged = JSON.parse(entries.get('extension/package.json').toString('utf8'));
    for (const field of ['name', 'publisher', 'version', 'main', 'icon']) {
        if (packaged[field] !== manifest[field]) {
            failures.push(`The packaged ${field} "${packaged[field]}" does not match package.json "${manifest[field]}".`);
        }
    }
    if (!packaged.engines || packaged.engines.vscode !== manifest.engines.vscode) {
        failures.push('The packaged engines.vscode does not match package.json.');
    }
    if (manifest.icon && !entries.has(`extension/${manifest.icon.replace(/\\/g, '/')}`)) {
        failures.push(`The VSIX is missing the manifest icon ${manifest.icon}.`);
    }
    const vsixManifest = (entries.get('extension.vsixmanifest') || Buffer.alloc(0)).toString('utf8');
    const markedPreRelease = vsixManifest.includes('Microsoft.VisualStudio.Code.PreRelease');
    if (options.preRelease !== markedPreRelease) {
        failures.push(options.preRelease
            ? 'The VSIX was not marked as a pre-release although --pre-release was requested.'
            : 'The VSIX is marked as a pre-release although --pre-release was not requested.');
    }
    if (failures.length) { throw new Error(failures.join('\n')); }
    return entries.size;
}

function publishVsix(report, options, vsixPath) {
    const args = [resolveVsceEntry(), 'publish', '--packagePath', vsixPath];
    if (options.preRelease) { args.push('--pre-release'); }
    runStage(report, 'publish-marketplace', args);
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(usage);
        return;
    }
    const manifestPath = path.join(root, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    validatePreflight(options, manifest);

    const outputDirectory = path.resolve(root, options.out);
    const vsixPath = path.join(outputDirectory, `${manifest.name}-${manifest.version}.vsix`);
    const report = {
        startedAt: new Date().toISOString(),
        node: process.version,
        mode: options.publish ? 'publish' : 'dry-run',
        preRelease: options.preRelease,
        verified: null,
        extension: `${manifest.publisher}.${manifest.name}`,
        version: manifest.version,
        commit: gitOutput(['rev-parse', 'HEAD']),
        vsix: null,
        stages: [],
        published: false,
        success: false,
    };
    activeReport = report;
    saveReport(report);

    if (options.skipVerify) {
        report.verified = 'skipped';
        console.warn('\nWarning: verification was skipped. Do not publish unverified output.');
    } else if (options.publish || options.verify) {
        report.verified = 'verify:release';
        runStage(report, 'verify:release', [resolveNpmCli(), 'run', 'verify:release'], { V6_REQUIRE_LIVE: 'true' });
    } else {
        report.verified = 'ci';
        runStage(report, 'ci', [resolveNpmCli(), 'run', 'ci']);
    }

    if (!fs.existsSync(path.join(root, 'out', 'extension.js'))) {
        throw new Error('out/extension.js is missing. Run npm run compile before packaging.');
    }
    fs.mkdirSync(outputDirectory, { recursive: true });
    fs.rmSync(vsixPath, { force: true });
    const packageArgs = [resolveVsceEntry(), 'package', '--out', vsixPath];
    if (options.preRelease) { packageArgs.push('--pre-release'); }
    runStage(report, 'package', packageArgs);

    const packagedEntries = await validateVsix(vsixPath, manifest, options);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(vsixPath)).digest('hex');
    report.vsix = { path: path.relative(root, vsixPath).replace(/\\/g, '/'), entries: packagedEntries, sha256 };
    saveReport(report);
    console.log(`\nVSIX validated: ${report.vsix.path} (${packagedEntries} entries)`);
    console.log(`SHA-256: ${sha256}`);

    if (!options.publish) {
        report.success = true;
        report.finishedAt = new Date().toISOString();
        saveReport(report);
        console.log('\nNo publication was performed (dry run).');
        console.log(`Install locally with: code --install-extension ${vsixPath}`);
        console.log('Publish with: npm run publish:marketplace');
        return;
    }

    publishVsix(report, options, vsixPath);
    report.published = true;
    report.finishedAt = new Date().toISOString();
    report.success = true;
    saveReport(report);
    console.log(`\nPublished ${report.extension}@${report.version}.`);
    console.log(`${marketplaceItem}${report.extension}`);
}

module.exports = {
    parseArgs,
    validatePreflight,
    validateVsix,
    requiredEntries,
    forbiddenPrefixes,
};

if (require.main === module) {
    main().catch(error => {
        console.error(`\n${error.message}`);
        if (activeReport) {
            activeReport.error = error.message;
            activeReport.finishedAt = new Date().toISOString();
            saveReport(activeReport);
        }
        process.exitCode = 1;
    });
}
