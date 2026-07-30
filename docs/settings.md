# Settings and Error UX

## Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `v6.emulatorPath` | string | `""` | Path to v6emul binary (checked before `V6EMUL` env var and PATH) |
| `v6.assemblerPath` | string | `""` | Path to v6asm executable (checked before `V6ASM` env var and PATH) |
| `v6.fddToolPath` | string | `""` | Path to v6fdd executable (checked before `V6FDD` env var and PATH) |
| `v6.logLevel` | enum | `"info"` | Logging verbosity (error/warn/info/debug) |

## Tool Resolution Order

External tools (`v6asm`, `v6fdd`) are not bundled with the extension. Each tool is located using the following priority order:

1. **VS Code setting** (`v6.emulatorPath` / `v6.assemblerPath` / `v6.fddToolPath`) — workspace or user setting; most explicit.
2. **Environment variable** (`V6EMUL` / `V6ASM` / `V6FDD`) — useful for CI/CD and for developers who drive builds from the terminal. Because generated Makefiles use `V6ASM ?= v6asm`, the same variable controls both `make` and the extension.
3. **PATH lookup** — works if the tool is installed globally and `v6asm`/`v6fdd` is on `PATH`.

If none of the above succeed, the extension shows an actionable error notification.

## Settings Validation

When `v6.emulatorPath` is changed via VS Code settings, the extension validates the path exists and shows a warning if it does not. The emulator will still launch using fallback resolution (bundled binary or PATH).

## Error UX (`src/platform/errors/error-ux.ts`)

Maps `V6Error` codes to user-friendly VS Code notifications with contextual actions:

| Error Code | Notification | Action |
|------------|-------------|--------|
| `EMULATOR_NOT_FOUND` | "Emulator not found. Set v6.emulatorPath, set the V6EMUL environment variable, or add v6emul to PATH." | Open Settings |
| `ASSEMBLER_NOT_FOUND` | "Assembler not found. Set v6.assemblerPath, set the V6ASM environment variable, or add v6asm to PATH." | Open Settings |
| `EXECUTABLE_NOT_FOUND` | "Executable not found. Build the project first." | Open Terminal |
| `CONFIG_INVALID` | "Project configuration is invalid." | — |
| `EMULATOR_LAUNCH_FAILED` | "Failed to launch the emulator." | Show Output |
| `IPC_CONNECTION_REFUSED` | "Could not connect to the emulator." | Show Output |
| `IPC_TIMEOUT` | "Emulator communication timed out." | Show Output |
| `IPC_DECODE_ERROR` | "Received a malformed response from the emulator." | Show Output |
