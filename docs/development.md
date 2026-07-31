# Development

## Prerequisites

External build tools are not bundled with the extension. Download them and configure the extension to find them:

| Tool | Download | Purpose |
|------|----------|---------|
| `v6emul` | [github.com/parallelno/v6emul/releases](https://github.com/parallelno/v6emul/releases) | Vector-06c emulator |
| `v6asm` | [github.com/parallelno/v6asm/releases](https://github.com/parallelno/v6asm/releases) | Intel 8080 assembler |
| `v6fdd` | [github.com/parallelno/v6asm/releases](https://github.com/parallelno/v6asm/releases) | FDD image builder |
| `v6c` | [github.com/parallelno/v6c/releases](https://github.com/parallelno/v6c/releases) | C compiler (optional) |

To configure tool paths, use one of three methods (evaluated in this order):

**Option 1 — VS Code workspace setting** (recommended for project-specific paths):

```json
// .vscode/settings.json
{
  "v6.emulatorPath": "C:/Work/Programming/v6emul/build/release/app/Release/v6emul.exe",
  "v6.assemblerPath": "C:/Work/Programming/v6asm/target/release/v6asm.exe",
  "v6.fddToolPath": "C:/Work/Programming/v6asm/target/release/v6fdd.exe"
}
```

**Option 2 — Environment variable** (recommended for CI/CD; also controls `make` because generated Makefiles use `V6ASM ?= v6asm`):

```powershell
# PowerShell (permanent via system environment)
[System.Environment]::SetEnvironmentVariable('V6EMUL', 'C:\Work\Programming\v6emul\build\release\app\Release\v6emul.exe', 'User')
[System.Environment]::SetEnvironmentVariable('V6ASM', 'C:\Work\Programming\v6asm\target\release\v6asm.exe', 'User')
[System.Environment]::SetEnvironmentVariable('V6FDD', 'C:\Work\Programming\v6asm\target\release\v6fdd.exe', 'User')
```

```bash
# Bash / shell profile
export V6EMUL=/path/to/v6emul
export V6ASM=/path/to/v6asm
export V6FDD=/path/to/v6fdd
```

**Option 3 — PATH** (works if the tools are globally installed).

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

See `test/features/README.md` for prerequisites and deterministic `result.txt` rules. The metadata runner is operational. The real-emulator DAP runner intentionally fails until its automated scenario is implemented and never writes a partial result.
