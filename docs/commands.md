# Commands

## V6: Create Project

Three-step interactive flow:

1. **Project name** — `showInputBox` with validation (non-empty, filesystem-safe, max 100 chars).
2. **Language** — `showQuickPick`: ASM (Intel 8080 assembly) or C (via v6c compiler).
3. **Executable type** — `showQuickPick`: ROM (direct binary) or FDD (floppy disk image).

Generated files in workspace root:

| File | Purpose |
|------|---------|
| `<name>.project.json` | Project configuration |
| `Makefile` | Build recipe (one of 4 variants: asm-rom, asm-fdd, c-rom, c-fdd) |
| `main.asm` or `main.c` | Starter source file |
| `out/` | Output directory for build artifacts |

Templates live in `src/templates/` and use `{{key}}` placeholder expansion.

## V6: Run Project

1. Resolves the active project via `ActiveProjectService` (auto-selects if one, QuickPick if multiple).
2. Validates the executable file exists on disk. Throws `V6Error(EXECUTABLE_NOT_FOUND)` if missing.
3. If the emulator is already running — hot-reloads the executable via `LOAD_ROM` or `MOUNT_FDD` IPC commands without restarting the emulator process.
4. If no emulator is running — launches via `EmulatorLifecycle.start()`.
5. Reveals or creates the emulator webview panel.

## FDD Persistence

When the emulator stops (or the panel closes), if the loaded executable is a `.fdd` file:

- If `fddReadOnly` is `true` → skip entirely, discard in-memory writes.
- If `fddReadOnly` is `false` → `GET_FDD_INFO` checks if the drive is mounted and updated → `GET_FDD_IMAGE` exports the disk image → write to disk → `RESET_UPDATE_FDD`.

This is wired into `EmulatorLifecycle.stop()` via an `onBeforeStop` hook in `extension.ts`.
