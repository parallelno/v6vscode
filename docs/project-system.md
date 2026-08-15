# Project System

Discovers, parses, validates, and manages `*.project.json` files.

## Modules (`src/project/`)

- **`model/v6-project.ts`** — `V6Project` and `V6ProjectRun` interfaces. `V6Project` carries the parsed config plus the source file `Uri`.
- **`parsing/project-parser.ts`** — `parse(text): unknown`. Pure JSON parse with `V6Error` wrapping on failure.
- **`validation/project-validator.ts`** — `validate(data): ValidationResult`. Manual schema check against the known shape. Returns typed `{ ok, name, run }` with defaults applied, or `{ ok: false, errors }`. Rejects unknown keys.
- **`discovery/project-discovery.ts`** — `findProjects(roots): Promise<Uri[]>`. Globs `*.project.json` at each workspace root (depth 0) via `vscode.workspace.findFiles`.
- **`persistence/project-repository.ts`** — `load(uri): Promise<V6Project>` reads, parses, validates, resolves relative paths to absolute. `save(project)` serializes back to JSON.
- **`active/active-project-service.ts`** — `resolve(): Promise<V6Project | undefined>`. Auto-selects if one project, shows QuickPick if multiple, returns `undefined` if none.

## Project File Schema

Files named `*.project.json` at the workspace root. Validated by `config/schemas/v6.project.schema.json`.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | string | yes | — | Project display name |
| `run.executable` | string | yes | — | Path to ROM or FDD image |
| `run.debugArtifact` | string | no | — | Companion ELF containing source lines and symbols |
| `run.bootRom` | string | no | bundled | Boot ROM path |
| `run.loadAddr` | string | no | `"0x100"` | Load address (hex) |
| `run.fddReadOnly` | boolean | no | `false` | Discard FDD writes on stop |
| `run.speed` | string | no | `"100%"` | Emulation speed |
| `run.viewMode` | string | no | `"borderless"` | Display mode: borderless, border, full |
