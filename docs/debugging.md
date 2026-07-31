# Debugging

## Project Configuration

A project can declare its executable and default companion ELF together:

```json
{
  "name": "demo",
  "run": {
    "executable": "out/demo.rom",
    "debugArtifact": "out/demo.elf",
    "loadAddr": "0x100"
  }
}
```

Paths are resolved relative to the `*.project.json` file. An explicit `debugArtifact` in `.vscode/launch.json` overrides the project default.

## Starting A Session

Choose a `Vector-06C` launch configuration and press F5. A debug launch:

1. Starts `v6emul` on a free local TCP port.
2. Opens one shared IPC connection.
3. Attaches the backend debugger and loads the companion ELF.
4. Opens the emulator display panel on that shared session.
5. Configures source and instruction breakpoints before running.

Closing the display panel does not terminate an active debug session. Ending a launch session terminates its emulator process.

## Supported Debug Surfaces

- Continue, pause, Step Into, and basic Step Over.
- ASM source breakpoints resolved through final ELF/DWARF metadata.
- Instruction breakpoints using CPU addresses.
- One current CPU stack frame with source highlighting when mapped.
- Registers, flags, and a raw stack sample in Variables.
- Register names and numeric literals in Watch/evaluate.
- V6 Hardware Statistics in the Run and Debug sidebar.

Verified source breakpoints show their resolved CPU address in the breakpoint tooltip.

## Debug Metadata Errors

Source breakpoints remain unverified when the ELF is missing, malformed, or does not match the loaded ROM. The breakpoint tooltip and Debug Console report the artifact error. `No executable code at line ...` is used only after metadata loaded successfully and the source file/line has no applicable statement row.

## Current Limitations

The backend does not yet expose versioned capabilities, reliable stop records, watchpoint hit identity, or bulk global-memory operations. Consequently:

- Stop reasons can be inferred but are not authoritative for every stop cause.
- DAP data breakpoints are not enabled.
- The Hex Viewer is not implemented.
- Semantic caller frames, C locals, and Step Out require variable-location and unwind metadata not currently emitted by the toolchain.
- Debug attach does not yet share an externally owned emulator session with the display panel.

## Verification

```powershell
npm run test:unit
npm run test:regression
npm run test:feature:metadata
```

The gated real-emulator scenario is documented in `test/features/README.md`.
