# V6 Debug Feature Verification

These checks complement the fast Mocha suite with real artifact and emulator workflows.

## Prerequisites

- Node.js and project dependencies (`npm install`).
- PowerShell 7 or Windows PowerShell 5.1.
- A debug-enabled `v6emul` available through `v6.emulatorPath`, `V6EMUL`, or `PATH` for the real-emulator scenario.
- `v6asm` available through `V6ASM` or `PATH` when rebuilding metadata fixtures.

## Debug metadata

Run:

```powershell
npm run test:feature:metadata
```

The runner loads `temp/project/out/demo1.elf` and `demo1.rom`, validates their byte identity, and verifies source-to-address and address-to-source mapping. Rebuild the fixture first when source changes:

```powershell
Set-Location temp/project
make
```

On success the runner writes `test/features/debug-metadata/result.txt`. The result contains stable scenario IDs and SHA-256 artifact hashes, without timestamps or machine-specific paths.

## Debug adapter

Run:

```powershell
$env:V6EMUL = 'C:\path\to\v6emul.exe'
npm run test:feature:debug
```

This scenario is reserved for end-to-end launch, breakpoint, stepping, display coexistence, and cleanup checks. It must fail explicitly when the emulator or fixture is unavailable. A successful run writes `test/features/debug-adapter/result.txt`; failed or partial runs must not update that file.

## Result policy

- Commit a `result.txt` only after every assertion in that feature runner passes.
- Do not include timestamps, temporary ports, or absolute paths.
- Include producer/emulator versions when available, passed scenario IDs, and artifact hashes.
- Delete stale result files before changing assertions or fixtures.
