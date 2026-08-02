$ErrorActionPreference = 'Stop'

$resultPath = Join-Path $PSScriptRoot 'result.txt'
Remove-Item $resultPath -ErrorAction SilentlyContinue

if ([string]::IsNullOrWhiteSpace($env:V6EMUL) -or -not (Test-Path -LiteralPath $env:V6EMUL -PathType Leaf)) {
    throw 'Set V6EMUL to a debugger-enabled v6emul executable before running the real-emulator feature test.'
}

$v6emulPath = (Resolve-Path -LiteralPath $env:V6EMUL).Path

throw 'The automated real-emulator DAP scenario is not implemented yet. No result file was written.'
