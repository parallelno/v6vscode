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
3. Reads and validates server identity and protocol-2 capabilities through `GET_SERVER_INFO`.
4. Attaches the backend debugger and loads the companion ELF.
5. Opens the emulator display panel on that shared session.
6. Configures source and instruction breakpoints before running.

`V6EMUL` must contain the full path of the emulator executable. VS Code and any Extension Development Host inherit environment variables only when their processes start. After setting or changing a persistent `V6EMUL`, close existing Extension Development Host windows and restart VS Code before launching the extension again.

Servers must implement `GET_SERVER_INFO` and protocol version 2. Every session requires `GET_FRAME_RAW` and raw-frame schema 1. Debug sessions additionally require advertised debugger support, stack-sample schema 1, and the required debugger commands. Structured server error codes are preserved for diagnostics.

Display frames use the schema-1 `V6RF` binary envelope. Frame and error responses share this format, so transient `FRAME_UNAVAILABLE` responses are consumed without desynchronizing or closing the IPC connection.

Closing the display panel terminates the active debug launch and closes the Run and Debug session. Ending a launch session terminates its emulator process and closes the display panel.

## Supported Debug Surfaces

- Continue, pause, Step Into, and basic Step Over.
- ASM source breakpoints resolved through final ELF/DWARF metadata.
- Instruction breakpoints using CPU addresses.
- One current CPU stack frame with source highlighting when mapped.
- Registers, flags, and a raw stack sample in Variables.
- Register names and numeric literals in Watch/evaluate.
- V6 Hardware Statistics in the Run and Debug sidebar, including timing/display state, palette clipboard actions, RAM-disk mapping, and four-drive FDD mount/dismount actions when hardware-statistics schema 1 is advertised.
- A standalone Ports editor panel showing complete In and Out tables with changes since the previous paused update highlighted.
- A standalone Hex Viewer editor panel with numeric, symbol, and inclusive-range navigation when the backend advertises `GET_MEM` command 93. Inclusive ranges accept `11-14` and `11..14`. Clearing the search clears its highlight; clicking a visible symbol selects its range without scrolling.
- A standalone Memory Edits editor panel for adding and managing server-owned original, entered, and current byte values across Main RAM and every RAM-disk bank. It supports current-value filtering, inline Activity/value/Auto-update changes, clipboard actions, Hex Viewer navigation, and singular/bulk delete-and-restore workflows when memory-edit schema 1 is available.
- A standalone Performance editor panel for managing CodePerf ranges by stable server ID. It supports name filtering, inline name/start/end editing, Activity toggles, sampled average clock cycles and test counts, source navigation, and bulk disable/delete workflows when CodePerf schema 1 is available.
- A standalone Symbols editor panel that incrementally filters ELF symbols by name or resolved value, supports case/whole-name matching and history, opens exact source rows, and hands resolved symbol ranges to Hex Viewer.
- A standalone Watchpoints editor panel with structured add, edit, enable/disable, delete, bulk actions, bounded memory previews, and Hex Viewer navigation when the backend advertises watchpoint schema 1 and edit command 94.
- The Hex Viewer clears all cached bytes and becomes an empty panel when the emulator session stops.
- Double-clicking a Hex Viewer byte opens an expression editor. Enter or focus loss submits; Escape cancels. Literals, symbols, `+`, `-`, `*`, unary signs, and parentheses are supported, and the final value must fit in one byte. Accepted writes create or update a schema-1 memory-edit record rather than bypassing edit tracking.
- Authoritative stop attribution when v6emul advertises stop-record schema 1, including breakpoint, watchpoint, step, pause, and exception details.
- Execution polling uses the lightweight `IS_RUNNING` request and reads the stop record only after execution stops.
- DAP data breakpoints backed by structured v6emul watchpoints when both watchpoint schema 1 and stop-record schema 1 are available.

Verified source breakpoints show their resolved CPU address in the breakpoint tooltip.

## Debug Metadata Errors

Source breakpoints remain unverified when the ELF is missing, malformed, or does not match the loaded ROM. The breakpoint tooltip and Debug Console report the artifact error. `No executable code at line ...` is used only after metadata loaded successfully and the source file/line has no applicable statement row.

## Current Limitations

Older backends without stop-record schema 1 use running-state detection. Consequently, with those backends:

- Stop reasons are inferred and are not authoritative for every stop cause.
- DAP data breakpoints and exception details are not enabled.
- The Hex Viewer reports an unsupported backend instead of falling back to repeated per-byte requests when `GET_MEM` is unavailable.
- Semantic caller frames, C locals, and Step Out require variable-location and unwind metadata not currently emitted by the toolchain.
- Debug attach does not yet share an externally owned emulator session with the display panel.

## Verification

```powershell
npm run test:unit
npm run test:regression
npm run test:feature:metadata
```

The gated real-emulator scenario is documented in `test/features/README.md`.
