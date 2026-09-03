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
$elfPath = Join-Path $repoRoot 'temp\cdbg\probe-O0.elf'
$romPath = Join-Path $repoRoot 'temp\cdbg\probe-O0.rom'
if (-not (Test-Path -LiteralPath $elfPath) -or -not (Test-Path -LiteralPath $romPath)) {
    throw 'C debug probe artifacts are missing. Build temp/cdbg before running the real-emulator feature test.'
}

Push-Location $repoRoot
try {
    npm run test:integration
    if ($LASTEXITCODE -ne 0) { throw 'Real-emulator Call Stack integration failed.' }

    $version = (& $v6emulPath --version | Select-Object -First 1).Trim()
    $elfHash = Get-Sha256 $elfPath
    $romHash = Get-Sha256 $romPath
    $result = @(
        'status=passed',
        'scenarios=extension-host-startup,c-source-breakpoint,three-function-call-stack,c-frame-scopes-and-watch',
        "v6emul.version=$version",
        "elf.sha256=$elfHash",
        "rom.sha256=$romHash",
        ''
    ) -join [Environment]::NewLine
    Set-Content -LiteralPath $resultPath -Value $result -Encoding ascii
    Write-Output $result
} finally {
    Pop-Location
}
