# Development

## Prerequisites

External tools are not bundled with the extension:

| Tool | Download | Purpose |
|------|----------|---------|
| `v6emul` | [github.com/parallelno/v6emul/releases](https://github.com/parallelno/v6emul/releases) | Vector-06c emulator |
| `v6asm` | [github.com/parallelno/v6asm/releases](https://github.com/parallelno/v6asm/releases) | Intel 8080 assembler |
| `v6fdd` | [github.com/parallelno/v6asm/releases](https://github.com/parallelno/v6asm/releases) | FDD image builder |
| `v6c` | [github.com/parallelno/v6c/releases](https://github.com/parallelno/v6c/releases) | C compiler (optional) |

Set `V6EMUL` to the full emulator executable path. It is the only external-tool variable read by the extension.

```powershell
# PowerShell (permanent via system environment)
[System.Environment]::SetEnvironmentVariable('V6EMUL', 'C:\Work\Programming\v6emul\build\release\app\Release\v6emul.exe', 'User')
```

```bash
# Bash / shell profile
export V6EMUL=/path/to/v6emul
```

The extension does not invoke `v6asm` or `v6fdd`. Generated Makefiles use the shell's `PATH` by default. Set `V6ASM` or `V6FDD` in the build environment only when overriding those command paths.

## Building

```bash
npm install
npm run compile
```

## Packaging

```bash
npm run package          # produces v6vscode-<version>.vsix
```

The `.vscodeignore` file excludes `src/`, `test/`, `design/`, `temp/`, `docs/`, source maps, and other dev-only files from the packaged `.vsix`.

## Testing

```bash
npm test              # unit tests
npm run test:unit     # unit tests only
npm run test:regression  # regression suite
npm run test:feature:metadata # real ELF/ROM consumer conformance
npm run test:feature:debug    # gated real-emulator scenario
npm run test:all      # unit + regression
npm run ci            # compile + lint + test:all
```

`test:feature:debug` requires both `V6EMUL` and `V6C`. It compiles the C probe at `-O0`, `-O1`, and `-O2`, then verifies Extension Host startup, source breakpoints and stepping, optimization-aware relocation, inline frames, semantic Call Stack, and C frame scopes/Watch expressions against a real emulator. See `test/features/README.md` for prerequisites and deterministic `result.txt` rules.
