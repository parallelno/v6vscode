$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$elfPath = Join-Path $repoRoot 'temp\project\out\demo2.elf'
$romPath = Join-Path $repoRoot 'temp\project\out\demo2.rom'
$resultPath = Join-Path $PSScriptRoot 'result.txt'

Remove-Item $resultPath -ErrorAction SilentlyContinue

if (-not (Test-Path $elfPath) -or -not (Test-Path $romPath)) {
    throw 'Debug fixture is missing. Build temp/project before running metadata conformance.'
}

Push-Location $repoRoot
try {
    $script = @'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadDebugArtifact } = require('./src/debug/metadata/debug-artifact-loader');

(async () => {
    const elfPath = path.resolve('./temp/project/out/demo2.elf');
    const romPath = path.resolve('./temp/project/out/demo2.rom');
    const sourcePath = path.resolve('./temp/project/src2/main.c');
    const loaded = await loadDebugArtifact(elfPath, romPath);
    const breakpoint = loaded.index.resolveBreakpoint(sourcePath, 43);
    if (!breakpoint) throw new Error('source-line-43 did not resolve');
    const location = loaded.index.resolveAddress(breakpoint.address);
    if (!location || location.line !== breakpoint.verifiedLine) {
        throw new Error('address-to-source round trip failed');
    }
    const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    process.stdout.write([
        'status=passed',
        'scenarios=artifact-load,rom-elf-match,source-breakpoint,address-round-trip',
        `elf.sha256=${hash(elfPath)}`,
        `rom.sha256=${hash(romPath)}`,
        '',
    ].join('\n'));
})().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
'@
    $output = node -r ts-node/register -e $script
    if ($LASTEXITCODE -ne 0) { throw 'Metadata conformance failed.' }
    Set-Content -Path $resultPath -Value $output -Encoding ascii
    Write-Output $output
} finally {
    Pop-Location
}
