# V6 Debug Feature Verification

These checks complement the fast Mocha suite with real artifact and emulator workflows.

## Prerequisites

- Node.js and project dependencies (`npm install`).
- PowerShell 7 or Windows PowerShell 5.1.
- A debug-enabled `v6emul` executable specified by `V6EMUL` for every real-emulator test. Tests do not read VS Code settings or search `PATH`.
- `v6asm` available through `V6ASM` when rebuilding metadata fixtures.

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

On Windows, persist the variable for future VS Code and terminal processes with:

```powershell
[Environment]::SetEnvironmentVariable('V6EMUL', 'C:\path\to\v6emul.exe', 'User')
```

Restart VS Code after changing a persistent environment variable because an existing extension host retains the environment with which it was started.

This scenario verifies Extension Host startup and a real C `add8 -> accumulate -> main` Call Stack from the checked-in `temp/cdbg` probe. It asserts semantic frame names and order after stopping in `add8`. Each frame remains valid only for the current stopped generation. The runner must fail explicitly when the emulator or fixture is unavailable. A successful run writes `test/features/debug-adapter/result.txt`; failed or partial runs must not update that file.

## Result policy

- Commit a `result.txt` only after every assertion in that feature runner passes.
- Do not include timestamps, temporary ports, or absolute paths.
- Include producer/emulator versions when available, passed scenario IDs, and artifact hashes.
- Delete stale result files before changing assertions or fixtures.
