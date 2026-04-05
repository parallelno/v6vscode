# Settings and Error UX

## Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `v6.emulatorPath` | string | `""` | Override path to v6emul binary |
| `v6.logLevel` | enum | `"info"` | Logging verbosity (error/warn/info/debug) |

## Settings Validation

When `v6.emulatorPath` is changed via VS Code settings, the extension validates the path exists and shows a warning if it does not. The emulator will still launch using fallback resolution (bundled binary or PATH).

## Error UX (`src/platform/errors/error-ux.ts`)

Maps `V6Error` codes to user-friendly VS Code notifications with contextual actions:

| Error Code | Notification | Action |
|------------|-------------|--------|
| `EMULATOR_NOT_FOUND` | "Emulator not found. Set v6.emulatorPath or add v6emul to PATH." | Open Settings |
| `EXECUTABLE_NOT_FOUND` | "Executable not found. Build the project first." | Open Terminal |
| `CONFIG_INVALID` | "Project configuration is invalid." | — |
| `EMULATOR_LAUNCH_FAILED` | "Failed to launch the emulator." | Show Output |
| `IPC_CONNECTION_REFUSED` | "Could not connect to the emulator." | Show Output |
| `IPC_TIMEOUT` | "Emulator communication timed out." | Show Output |
| `IPC_DECODE_ERROR` | "Received a malformed response from the emulator." | Show Output |
