$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$elfPath = Join-Path $repoRoot 'test\fixtures\baseline\demo1.elf'
$resultPath = Join-Path $PSScriptRoot 'result.txt'

Remove-Item $resultPath -ErrorAction SilentlyContinue

if (-not (Test-Path $elfPath)) {
    throw 'Mandatory baseline ELF fixture is missing. Restore test/fixtures/baseline/demo1.elf.'
}

Push-Location $repoRoot
try {
    $script = @'
const fs = require('fs');
const crypto = require('crypto');
const { loadDebugArtifact } = require('./src/debug/metadata/debug-artifact-loader');

(async () => {
    const { fixturePath, fixtureRom } = require('./src/test/fixture-paths');
    const elfPath = fixturePath('baseline', 'demo1.elf');
    const romPath = fixtureRom(elfPath);
    const sourcePath = fixturePath('baseline', 'main.asm');
    const loaded = await loadDebugArtifact(elfPath, romPath);
    const breakpoint = loaded.index.resolveBreakpoint(sourcePath, 6);
    if (!breakpoint) throw new Error('baseline main source line did not resolve');
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
