# Settings and Error UX

## Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `v6.logLevel` | enum | `"info"` | Logging verbosity (error/warn/info/debug) |
| `v6.scriptOverlays.hidden` | boolean | `false` | Hide all script overlays in the emulator Display |
| `v6.scriptOverlays.fontSize` | integer | `12` | Script overlay text size in framebuffer pixels (`6..48`) |
| `v6.debug.sourceStepFilters` | string array | `[]` | Source path globs skipped while selecting C Step Into/Over targets |
| `v6.debug.sourceStepMaxInstructions` | integer | `10000` | Maximum internal instructions in one C source step (`1..1000000`) |
| `v6.debug.sourceStepMaxElapsedMs` | integer | `5000` | Maximum elapsed milliseconds in one C source step (`1..60000`) |
| `v6.debug.sourceStepMaxCandidates` | integer | `64` | Maximum temporary source-step breakpoints (`1..1024`) |

Script overlay settings are global VS Code user preferences. They are not stored in project JSON and remain available when no V6 project is active.

## Tool Resolution

External tools are not bundled with the extension. The extension directly launches only `v6emul` and resolves it exclusively from `V6EMUL`, which must contain the full executable path.

The extension does not discover or invoke `v6asm` or `v6fdd`. Generated Makefiles use `v6asm` and `v6fdd` from the shell's `PATH` by default and accept optional `V6ASM` and `V6FDD` overrides. Restart VS Code after changing persistent `V6EMUL` so the extension host inherits it.

If none of the above succeed, the extension shows an actionable error notification.

## Error UX (`src/platform/errors/error-ux.ts`)

Maps `V6Error` codes to user-friendly VS Code notifications with contextual actions:

| Error Code | Notification | Action |
|------------|-------------|--------|
| `EMULATOR_NOT_FOUND` | "Emulator not found. Set V6EMUL to the full path of the v6emul executable and restart VS Code." | — |
| `EXECUTABLE_NOT_FOUND` | "Executable not found. Build the project first." | Open Terminal |
| `CONFIG_INVALID` | "Project configuration is invalid." | — |
| `EMULATOR_LAUNCH_FAILED` | "Failed to launch the emulator." | Show Output |
| `IPC_CONNECTION_REFUSED` | "Could not connect to the emulator." | Show Output |
| `IPC_TIMEOUT` | "Emulator communication timed out." | Show Output |
| `IPC_DECODE_ERROR` | "Received a malformed response from the emulator." | Show Output |
