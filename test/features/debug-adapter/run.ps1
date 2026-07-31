$ErrorActionPreference = 'Stop'

$resultPath = Join-Path $PSScriptRoot 'result.txt'
Remove-Item $resultPath -ErrorAction SilentlyContinue

if (-not $env:V6EMUL -or -not (Test-Path $env:V6EMUL)) {
    throw 'Set V6EMUL to a debugger-enabled v6emul executable before running the real-emulator feature test.'
}

throw 'The automated real-emulator DAP scenario is not implemented yet. No result file was written.'
