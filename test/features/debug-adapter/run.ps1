$ErrorActionPreference = 'Stop'

$resultPath = Join-Path $PSScriptRoot 'result.txt'
Remove-Item $resultPath -ErrorAction SilentlyContinue

function Get-Sha256([string]$path) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha256.ComputeHash([System.IO.File]::ReadAllBytes($path))
        return ([System.BitConverter]::ToString($hash)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha256.Dispose()
    }
}

if ([string]::IsNullOrWhiteSpace($env:V6EMUL) -or -not (Test-Path -LiteralPath $env:V6EMUL -PathType Leaf)) {
    throw 'Set V6EMUL to a debugger-enabled v6emul executable before running the real-emulator feature test.'
}

$v6emulPath = (Resolve-Path -LiteralPath $env:V6EMUL).Path

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$fixtureRoot = Join-Path $repoRoot 'test\fixtures\cdbg'
@('O0', 'O1', 'O2') | ForEach-Object {
    $makefile = Join-Path $fixtureRoot "Makefile.$_"
    if (-not (Test-Path -LiteralPath $makefile -PathType Leaf)) {
        throw "Required C debug probe recipe is missing: $makefile"
    }

    Push-Location $fixtureRoot
    try {
        & make -B -f "Makefile.$_"
        if ($LASTEXITCODE -ne 0) { throw "C debug probe build failed: Makefile.$_" }
    } finally {
        Pop-Location
    }
}

$artifacts = @('O0', 'O1', 'O2') | ForEach-Object {
    [PSCustomObject]@{
        Optimization = $_
        Elf = Join-Path $repoRoot "test\fixtures\cdbg\probe-$_.elf"
        Rom = Join-Path $repoRoot "test\fixtures\cdbg\probe-$_.rom"
    }
}
if ($artifacts | Where-Object { -not (Test-Path -LiteralPath $_.Elf) -or -not (Test-Path -LiteralPath $_.Rom) }) {
    throw 'C debug probe build completed without all expected artifacts.'
}
$elfPath = $artifacts[0].Elf
$romPath = $artifacts[0].Rom

Push-Location $repoRoot
try {
    npm run test:integration
    if ($LASTEXITCODE -ne 0) { throw 'Real-emulator Call Stack integration failed.' }

    $version = (& $v6emulPath --version | Select-Object -First 1).Trim()
    $elfHash = Get-Sha256 $elfPath
    $romHash = Get-Sha256 $romPath
    $result = @(
        'status=passed',
        'scenarios=extension-host-startup,c-source-breakpoint,c-source-step-into-over-and-out,o1-o2-omitted-line-relocation,o2-nested-inline-step-into-and-out,three-function-call-stack,c-frame-scopes-and-watch',
        "v6emul.version=$version",
        "elf.sha256=$elfHash",
        "rom.sha256=$romHash",
        "probe-O1.elf.sha256=$(Get-Sha256 $artifacts[1].Elf)",
        "probe-O1.rom.sha256=$(Get-Sha256 $artifacts[1].Rom)",
        "probe-O2.elf.sha256=$(Get-Sha256 $artifacts[2].Elf)",
        "probe-O2.rom.sha256=$(Get-Sha256 $artifacts[2].Rom)",
        ''
    ) -join [Environment]::NewLine
    Set-Content -LiteralPath $resultPath -Value $result -Encoding ascii
    Write-Output $result
} finally {
    Pop-Location
}
