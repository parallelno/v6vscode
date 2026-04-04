# v6vscode Implementation Plan

## 1. Overview

This plan converts the design requirements into an ordered implementation sequence for `v6vscode` — a VS Code extension providing an integrated development environment for the Vector-06C home computer.

The extension wraps three external tools (`v6asm`, `v6fdd`, `v6emul`) stored under `tools/` and orchestrates project management, build, emulation, and debugging through clean adapter layers.

### Core Artifacts

| Artifact | Producer | Purpose |
|----------|----------|---------|
| `*.rom` | v6asm | Vector-06C executable binary |
| `*.symbols.json` | v6asm | Debug symbols, address-to-source mappings, data line metadata |
| `*.project.json` | Extension | Project settings, build config, artifact references |
| `*.debug.json` | Extension | Runtime debug session state (breakpoints, watchpoints, preferences) |

### Ground Rules

1. No feature lands without a home in the domain layout.
2. No parsing logic duplicated across editor, build, and debug code.
3. No external tool called outside `src/tools/` adapters.
4. No debug feature depends on stale in-memory artifacts — always reload or verify freshness.
5. No milestone is complete until unit tests, regression tests, and `docs/` are updated.
6. VS Code API usage pushed to the edges; core logic stays testable without VS Code runtime.

---

## 2. Repository Layout

```
v6vscode/
  src/
    extension.ts                    # Composition root only
    platform/
      logging/logger.ts
      errors/error-codes.ts
      errors/v6-error.ts
      process/process-runner.ts
      files/path-service.ts
      files/workspace-service.ts
      events/event-bus.ts
      disposable/lifecycle.ts
    config/
      contribution-ids.ts
      schemas/
        v6.project.schema.json
        v6.debug.schema.json
    project/
      model/v6-project.ts
      model/v6-debug-state.ts
      parsing/project-parser.ts
      validation/project-validator.ts
      discovery/project-discovery-service.ts
      persistence/project-repository.ts
      active/active-project-service.ts
    artifacts/
      model/project-artifacts.ts
      symbols/symbols-parser.ts
      symbols/source-map-index.ts
      symbols/symbol-lookup-index.ts
      cache/artifact-index-service.ts
      freshness/artifact-freshness.ts
    tools/
      common/tool-locator.ts
      v6asm/v6asm-adapter.ts
      v6fdd/v6fdd-adapter.ts
      v6emul/v6emul-launcher.ts
    build/
      pipeline/build-pipeline-service.ts
      diagnostics/build-diagnostic-mapper.ts
      tasks/build-task-provider.ts
    language/
      navigation/include-link-provider.ts
      navigation/label-definition-provider.ts
      hovers/symbol-hover-provider.ts
      hovers/runtime-hover-provider.ts
      breakpoints/breakpoint-line-resolver.ts
    debug/
      adapter/v6-debug-adapter-factory.ts
      session/v6-debug-session.ts
      config/debug-config-provider.ts
      registers/register-model.ts
      breakpoints/breakpoint-binder.ts
      watchpoints/watchpoint-service.ts
      sourcemap/debug-source-mapper.ts
      state/debug-state-repository.ts
    emulator/
      client/emulator-ipc-client.ts
      protocol/ipc-codec.ts
      protocol/ipc-commands.ts
      lifecycle/emulator-lifecycle-service.ts
      panel/emulator-panel.ts
      panel/emulator-viewmodel.ts
      panel/assets/                 # Webview HTML/CSS/JS
    commands/
      create-project-command.ts
      build-project-command.ts
      build-dependencies-command.ts
      run-project-command.ts
      rebuild-disk-command.ts
    templates/
      project/
      asm/
  test/
    unit/
      platform/
      project/
      artifacts/
      tools/
      build/
      language/
      debug/
      emulator/
    integration/
    regression/
    fixtures/
      projects/
      symbols/
      artifacts/
  docs/
  design/
  res/
  tools/
```

---

## 3. Milestone Plan

### Milestone 1 — Foundation and Project Model

**Goal**: Extension activates, discovers projects, validates configs. Shared infrastructure in place.

#### Tasks

| # | Task | Domain |
|---|------|--------|
| 1.1 | Create `src/` directory tree per layout above | setup |
| 1.2 | Scaffold `package.json` with extension metadata, activation events, contributes | setup |
| 1.3 | Create `src/extension.ts` as composition root — construct services, register contributions, dispose | platform |
| 1.4 | Implement `platform/logging/logger.ts` — output channel + structured log levels | platform |
| 1.5 | Implement `platform/errors/` — typed error codes and `V6Error` class | platform |
| 1.6 | Implement `platform/process/process-runner.ts` — async child process wrapper with timeout + cancellation | platform |
| 1.7 | Implement `platform/files/path-service.ts` — relative/absolute resolution, `${extension}` token expansion | platform |
| 1.8 | Implement `platform/files/workspace-service.ts` — workspace folder access, file watchers | platform |
| 1.9 | Define JSON schema `config/schemas/v6.project.schema.json` | config |
| 1.10 | Define JSON schema `config/schemas/v6.debug.schema.json` | config |
| 1.11 | Define contribution IDs in `config/contribution-ids.ts` | config |
| 1.12 | Implement `project/model/v6-project.ts` — TypeScript interfaces for project config | project |
| 1.13 | Implement `project/model/v6-debug-state.ts` — TypeScript interfaces for debug state | project |
| 1.14 | Implement `project/parsing/project-parser.ts` — load and parse `*.project.json` | project |
| 1.15 | Implement `project/validation/project-validator.ts` — validate against schema + semantic checks | project |
| 1.16 | Implement `project/discovery/project-discovery-service.ts` — find `*.project.json` in workspace | project |
| 1.17 | Implement `project/persistence/project-repository.ts` — load/save project files | project |
| 1.18 | Implement `project/active/active-project-service.ts` — track selected project, prompt if multiple | project |
| 1.19 | Set up test infrastructure: Mocha config, fixture conventions, test helpers | test |
| 1.20 | Register language contribution for `.asm` files using existing `res/syntaxes/devector_8080.tmLanguage.json` | language |

#### Tests

- Unit: path resolution, project parsing, schema validation, discovery with 0/1/N project files.
- Regression: invalid JSON, missing required fields, relative path edge cases.

#### Docs

- `docs/project-file.md` — project file format reference.
- `docs/debug-state-file.md` — debug state file reference.
- Update root `README.md` with project status.

#### Exit Criteria

- Extension activates without errors.
- `*.project.json` files are discovered, parsed, and validated with structured diagnostics.
- No business logic in `extension.ts`.
- All platform utilities have unit tests.

---

### Milestone 2 — Tool Adapters and Build Pipeline

**Goal**: User can compile a project from VS Code. Build artifacts are produced and validated.

#### Tasks

| # | Task | Domain |
|---|------|--------|
| 2.1 | Implement `tools/common/tool-locator.ts` — resolve tool binary: extension setting → `tools/` bundled → PATH | tools |
| 2.2 | Implement `tools/v6asm/v6asm-adapter.ts` — construct CLI args, run, parse stdout/stderr, return structured result | tools |
| 2.3 | Implement `tools/v6fdd/v6fdd-adapter.ts` — template-based FDD image building | tools |
| 2.4 | Implement `build/pipeline/build-pipeline-service.ts` — orchestrate: validate → assemble → verify artifacts → optionally build FDD → report | build |
| 2.5 | Implement `build/diagnostics/build-diagnostic-mapper.ts` — map assembler errors/warnings to VS Code diagnostics | build |
| 2.6 | Implement `commands/build-project-command.ts` — command palette + context menu | commands |
| 2.7 | Implement `commands/build-dependencies-command.ts` — compile dependent projects in order | commands |
| 2.8 | Implement `commands/rebuild-disk-command.ts` — FDD regeneration from template + content | commands |
| 2.9 | Add output channel for build log | build |
| 2.10 | Verify `*.rom` and `*.symbols.json` existence after successful build | build |

#### v6asm CLI Reference

```
v6asm <source.asm> -o <out.rom> -s [-c i8080|z80] [-a <align>] [-l] [-q|-V]
```
- `-s` / `--symbols` → produces `*.symbols.json`
- `-l` / `--lst` → produces `*.lst` listing file
- `-o` → output ROM path

#### Tests

- Unit: CLI argument construction, tool locator precedence, diagnostic parsing.
- Integration: build pipeline with mocked process runner.
- Regression: missing tool binary, assembler non-zero exit, missing output artifacts.

#### Docs

- `docs/building.md` — build commands and troubleshooting.
- `docs/tool-setup.md` — tool path configuration.

#### Exit Criteria

- `v6asm` and `v6fdd` accessed only through adapters.
- Build failures classified: config error, missing tool, compile error, artifact missing.
- Build output appears in VS Code Problems panel.

---

### Milestone 3 — Artifact Model and Source Mapping

**Goal**: `*.symbols.json` is parsed into normalized in-memory indexes usable by language and debug services.

#### Tasks

| # | Task | Domain |
|---|------|--------|
| 3.1 | Implement `artifacts/model/project-artifacts.ts` — interfaces for parsed artifact bundle | artifacts |
| 3.2 | Implement `artifacts/symbols/symbols-parser.ts` — parse `*.symbols.json` (symbols, lineAddresses, dataLines) | artifacts |
| 3.3 | Implement `artifacts/symbols/source-map-index.ts` — bidirectional `address ↔ source location` lookup | artifacts |
| 3.4 | Implement `artifacts/symbols/symbol-lookup-index.ts` — `name → definition`, `address → symbol`, file inclusion graph | artifacts |
| 3.5 | Implement `artifacts/freshness/artifact-freshness.ts` — compare source timestamps vs artifact timestamps | artifacts |
| 3.6 | Implement `artifacts/cache/artifact-index-service.ts` — load, cache, invalidate, atomically replace indexes | artifacts |
| 3.7 | Integrate artifact reload into build pipeline — after successful build, refresh indexes automatically | build/artifacts |
| 3.8 | Add file watcher for `*.symbols.json` — trigger index reload on external changes | artifacts |

#### symbols.json Structure

```json
{
  "symbols": {
    "<name>": { "value": <int>, "path": "<relpath>", "line": <1-based>, "type": "label|const|func|macro|macroparam" }
  },
  "lineAddresses": {
    "<path>": { "<line>": [<addr>, ...] }
  },
  "dataLines": {
    "<path>": { "<line>": { "addr": <int>, "byteLength": <int>, "unitBytes": <int> } }
  }
}
```

#### Tests

- Unit: `symbols.json` parsing for each symbol type, source map forward/reverse lookups, data line parsing, freshness comparisons.
- Regression: stale artifact detection, reload after rebuild, corrupt/empty symbols file, multi-file include chains.

#### Docs

- `docs/artifacts.md` — artifact model and source mapping behavior.

#### Exit Criteria

- Source mapping is independent from editor UI and debug UI.
- Artifact indexes are replaced atomically (no partial state).
- Stale artifacts are detected and reported.

---

### Milestone 4 — Project Scaffolding and Language Features

**Goal**: User can create a project. Includes, labels, and constants are navigable. Hovers show symbol info.

#### Tasks

| # | Task | Domain |
|---|------|--------|
| 4.1 | Create project templates in `src/templates/` — starter `*.project.json`, starter `*.asm` | templates |
| 4.2 | Implement `commands/create-project-command.ts` — scaffold project from template | commands |
| 4.3 | Implement `language/navigation/include-link-provider.ts` — Ctrl+click on `.include` paths | language |
| 4.4 | Implement `language/navigation/label-definition-provider.ts` — Ctrl+click on labels/constants using artifact indexes | language |
| 4.5 | Implement `language/hovers/symbol-hover-provider.ts` — hover tooltip with hex/decimal value from symbols | language |
| 4.6 | Implement `language/breakpoints/breakpoint-line-resolver.ts` — determine which lines can have breakpoints using lineAddresses | language |
| 4.7 | Register all language providers in composition root | extension |
| 4.8 | Add context menu entries for create/build/run in Explorer sidebar | commands |

#### Navigation Strategy

- **Include links**: resolved directly from source text (no build required).
- **Label/constant navigation**: requires artifact indexes from last build. If stale or missing, degrade gracefully with a "build required" message.
- **Hover**: static symbol info always available from artifacts; runtime values added in M7.

#### Tests

- Unit: include path resolution, breakpoint eligibility rules, definition lookup against fixture artifacts.
- Integration: definition provider with multi-file fixture project.
- Regression: navigation with missing artifacts, navigation across included files.

#### Docs

- `docs/project-creation.md` — create project workflow.
- `docs/editor-features.md` — navigation, hover, breakpoints.

#### Exit Criteria

- Core editor features work without leaking parsing logic into providers.
- Missing/stale artifacts produce clear fallback behavior.

---

### Milestone 5 — Emulator Launcher and Webview Panel

**Goal**: ROM or FDD target launches in a VS Code panel with frame rendering and basic controls.

#### Tasks

| # | Task | Domain |
|---|------|--------|
| 5.1 | Implement `tools/v6emul/v6emul-launcher.ts` — start emulator process in `--serve` mode | tools |
| 5.2 | Implement `emulator/protocol/ipc-codec.ts` — length-prefixed MessagePack encode/decode | emulator |
| 5.3 | Implement `emulator/protocol/ipc-commands.ts` — typed command enums and request/response interfaces | emulator |
| 5.4 | Implement `emulator/client/emulator-ipc-client.ts` — TCP client, request-response, reconnect logic | emulator |
| 5.5 | Implement `emulator/lifecycle/emulator-lifecycle-service.ts` — launch, attach, stop, restart orchestration | emulator |
| 5.6 | Implement `emulator/panel/emulator-panel.ts` — webview panel creation, message bridge | emulator |
| 5.7 | Implement `emulator/panel/emulator-viewmodel.ts` — typed view model for panel state | emulator |
| 5.8 | Build webview assets: frame canvas, control toolbar (run/pause/stop/restart/speed), status bar | emulator |
| 5.9 | Implement frame fetch loop using `GET_FRAME_RAW` command | emulator |
| 5.10 | Implement ROM/FDD loading via `LOAD_ROM`/`LOAD_FDD` IPC commands | emulator |
| 5.11 | Implement speed control via `SET_CPU_SPEED` | emulator |
| 5.12 | Implement memory dump panel — 16×16 hex dump with PC tracking, address navigation | emulator |
| 5.13 | Implement keyboard input forwarding to emulator | emulator |
| 5.14 | Implement `commands/run-project-command.ts` — build (if needed) → launch emulator → load target | commands |

#### IPC Wire Format

- TCP loopback on configurable port (default from v6emul)
- Frame: `[4-byte uint32 LE length][MessagePack payload]`
- `GET_FRAME_RAW`: `[4-byte length][4-byte width][4-byte height][raw ABGR pixels]` — 768×312×4 = 958,464 bytes

#### Key IPC Commands for This Milestone

| cmd | Name | Purpose |
|-----|------|---------|
| -1 | PING | Health check |
| -3/-4 | GET_FRAME/GET_FRAME_RAW | Video frame |
| 1 | RUN | Resume execution |
| 2 | STOP | Pause execution |
| 5 | RESET | Reboot with ROM |
| 6 | RESTART | Reboot without ROM |
| 42 | SET_CPU_SPEED | Speed control |
| 14 | GET_BYTE_RAM | Memory read |
| 16 | GET_MEM_STRING_GLOBAL | Memory block read |

#### Tests

- Unit: IPC codec encode/decode, command serialization, viewmodel state transitions.
- Integration: emulator handshake with mock TCP server.
- Regression: connection failure, process crash recovery, panel close/reopen.

#### Docs

- `docs/emulator.md` — launch, controls, memory dump.
- `docs/troubleshooting.md` — connection issues.

#### Exit Criteria

- Emulator launch is independent from debug adapter.
- Panel is a thin consumer of runtime state, not a source of truth.
- Frame rendering achieves acceptable refresh rate.

---

### Milestone 6 — Debug Adapter Core

**Goal**: VS Code debug toolbar works. Registers visible. Breakpoints map source lines to emulator addresses. Current execution location highlighted.

#### Tasks

| # | Task | Domain |
|---|------|--------|
| 6.1 | Implement `debug/config/debug-config-provider.ts` — launch configuration types and resolution | debug |
| 6.2 | Implement `debug/adapter/v6-debug-adapter-factory.ts` — VS Code inline debug adapter factory | debug |
| 6.3 | Implement `debug/session/v6-debug-session.ts` — handle launch, continue, pause, step, restart, disconnect | debug |
| 6.4 | Implement `debug/registers/register-model.ts` — fetch registers via `GET_REGS` (cmd 11), format for Variables panel | debug |
| 6.5 | Implement `debug/sourcemap/debug-source-mapper.ts` — translate PC → source location using artifact index | debug |
| 6.6 | Implement `debug/breakpoints/breakpoint-binder.ts` — logical (file+line) → bound (address) translation, push to emulator | debug |
| 6.7 | Implement `debug/state/debug-state-repository.ts` — persist/load `*.debug.json` | debug |
| 6.8 | Implement step operations: `EXECUTE_INSTR` (step into), step over (run until next instruction), `EXECUTE_FRAME_NO_BREAKS` (step frame) | debug |
| 6.9 | Implement current line highlight — green for mapped source, yellow fallback for unmapped | debug |
| 6.10 | Wire breakpoint sync: editor toggle → `debug.json` persist → emulator IPC push | debug |
| 6.11 | Implement breakpoint rebinding after rebuild — recompute addresses from updated artifact index | debug |

#### Breakpoint Flow

```
User toggles breakpoint in .asm file
  → Extension resolves active project
  → Source line → address(es) via source-map-index
  → Store logical breakpoint (file + line) in *.debug.json
  → If debug session active: push address breakpoint to v6emul via IPC
  → On rebuild: rebind all logical breakpoints against new artifact index
```

#### Key IPC Commands for This Milestone

| cmd | Name | Purpose |
|-----|------|---------|
| 7 | EXECUTE_INSTR | Step into (single instruction) |
| 9 | EXECUTE_FRAME_NO_BREAKS | Step frame |
| 11 | GET_REGS | All registers: cc, pc, sp, af, bc, de, hl, ints, m |
| 12 | GET_REG_PC | Current program counter |
| 50+ | Breakpoint commands | Set/clear/get breakpoints (per IPC protocol debug section) |

#### Tests

- Unit: breakpoint binder (source → address), rebinder after address change, register formatting, `debug.json` serialization.
- Integration: debug session lifecycle with mock emulator, paused-state source mapping.
- Regression: breakpoint persistence across restart, line-to-address drift after rebuild.

#### Docs

- `docs/debugging.md` — debug session usage, registers, breakpoints.
- `docs/debug-state-file.md` — update with persistence behavior.

#### Exit Criteria

- Breakpoints persist as logical source locations, not raw addresses.
- Rebuild + restart preserves debugger intent.
- Registers visible in VS Code Variables panel during pause.

---

### Milestone 7 — Advanced Runtime Inspection

**Goal**: Richer debug workflows — watchpoints, runtime hovers, data directive highlights, instruction opcode tooltips.

#### Tasks

| # | Task | Domain |
|---|------|--------|
| 7.1 | Implement `debug/watchpoints/watchpoint-service.ts` — address-based memory watchpoints via IPC | debug |
| 7.2 | Implement symbol-aware watches — user enters symbol name, extension resolves to address | debug |
| 7.3 | Implement `language/hovers/runtime-hover-provider.ts` — live values when paused: labels show current address content, instructions show opcode bytes + decoded operands | language |
| 7.4 | Implement data directive highlighting — `.byte`/`.word` lines highlighted blue (read) / red (write) while paused, with memory hover | language |
| 7.5 | Implement current execution line decoration — translucent green highlight with HW state tooltip | debug |
| 7.6 | Implement stack preview panel / variable group | debug |
| 7.7 | Implement ROM hot-reload — on `.asm` save, recompile and apply memory diff patch with PC adjustment | build/debug |
| 7.8 | Restore panel state and debug preferences from `*.debug.json` on session start | debug |
| 7.9 | Improve session synchronization between editor, debugger, and emulator panel | debug/emulator |

#### Tests

- Unit: watchpoint mapping, runtime hover data extraction, hot-reload diff calculation.
- Integration: paused session with runtime hovers, watchpoint round-trip.
- Regression: watchpoint restore after restart, stale runtime data after resume.

#### Docs

- `docs/advanced-debugging.md` — watchpoints, watches, hovers, hot-reload.
- Update `docs/debugging.md` with live inspection features.

#### Exit Criteria

- Advanced debug UX does not introduce duplicate sources of truth.
- All runtime state flows through debug and artifact services.
- Hot-reload correctly adjusts PC using label proximity heuristic.

---

### Milestone 8 — Hardening and Release Preparation

**Goal**: Stable, polished extension ready for use.

#### Tasks

| # | Task | Domain |
|---|------|--------|
| 8.1 | Audit cross-domain imports — remove any that break module boundaries | all |
| 8.2 | Remove dead code and temporary scaffolding | all |
| 8.3 | Improve error messages and recovery paths across all workflows | all |
| 8.4 | Expand regression test coverage for all previously fixed bugs | test |
| 8.5 | Performance audit — extension activation time, frame rendering rate, IPC latency | platform/emulator |
| 8.6 | Verify disposable cleanup — no leaked file watchers, processes, or event listeners | platform |
| 8.7 | Review and finalize all `docs/` for accuracy and completeness | docs |
| 8.8 | Finalize `README.md` quick start guide | docs |
| 8.9 | Create extension icon at `res/images/icon.png` | res |
| 8.10 | Set up `package.json` packaging (`vsce package`) and verify `.vsix` | setup |
| 8.11 | Create `.vscodeignore` for clean packaging | setup |
| 8.12 | Manual smoke test matrix for all major workflows | test |

#### Tests

- Full unit test pass.
- Full integration test pass.
- Full regression test pass.
- Smoke tests: create project → build → run → pause → breakpoint → step → resume → restart.

#### Docs

- Finalize all docs: commands, project files, debugging, emulator, troubleshooting.
- Architecture notes in `design/` if decisions diverged from original plan.

#### Exit Criteria

- Extension installable as `.vsix`.
- All major workflows function end-to-end.
- Codebase layout still matches the design.
- No known critical bugs.

---

## 4. PR Sequence

Milestones should be delivered as focused PRs to keep changes reviewable.

| PR | Milestone | Scope |
|----|-----------|-------|
| PR 1 | M1 | Package structure, composition root, platform utilities, test harness |
| PR 2 | M1 | Project model, schemas, parser, validator, discovery |
| PR 3 | M1 | Syntax highlight registration, language configuration |
| PR 4 | M2 | Tool locator, v6asm adapter |
| PR 5 | M2 | Build pipeline, build command, diagnostics |
| PR 6 | M2 | v6fdd adapter, disk rebuild command |
| PR 7 | M3 | Symbols parser, source map index, symbol lookup index |
| PR 8 | M3 | Artifact cache service, freshness checks, reload integration |
| PR 9 | M4 | Project creation templates and command |
| PR 10 | M4 | Language providers: includes, definitions, hovers, breakpoint lines |
| PR 11 | M5 | IPC codec, command types, TCP client |
| PR 12 | M5 | Emulator launcher, lifecycle service |
| PR 13 | M5 | Webview panel, frame rendering, controls |
| PR 14 | M5 | Memory dump, keyboard input, run command |
| PR 15 | M6 | Debug config provider, debug session, registers |
| PR 16 | M6 | Breakpoint binder, source mapper, state persistence |
| PR 17 | M6 | Step operations, line highlight, rebuild rebinding |
| PR 18 | M7 | Watchpoints, watches, runtime hovers |
| PR 19 | M7 | Data highlights, hot-reload, state restoration |
| PR 20 | M8 | Hardening, cleanup, release prep |

---

## 5. Testing Strategy

### 5.1 Unit Tests (highest priority, run fast)

| Module | Key Cases |
|--------|-----------|
| `platform/files/path-service` | Relative resolution, `${extension}` expansion, Windows/POSIX paths |
| `project/parsing/project-parser` | Valid JSON, missing fields, extra fields, encoding |
| `project/validation/project-validator` | Schema violations, semantic checks (path exists, cpu valid) |
| `artifacts/symbols/symbols-parser` | All symbol types, lineAddresses, dataLines, empty file |
| `artifacts/symbols/source-map-index` | Forward/reverse lookup, multi-address lines, missing entries |
| `tools/v6asm/v6asm-adapter` | CLI argument construction, stdout/stderr parsing |
| `tools/common/tool-locator` | Priority: setting → bundled → PATH, missing binary |
| `build/diagnostics/build-diagnostic-mapper` | Error/warning/info classification, line number extraction |
| `emulator/protocol/ipc-codec` | Encode/decode MessagePack, length prefix, raw frame |
| `debug/breakpoints/breakpoint-binder` | Source → address binding, rebinding after address shift |
| `debug/state/debug-state-repository` | Serialize/deserialize `debug.json`, schema validation |

### 5.2 Integration Tests (cross-module, may use mocks)

1. Build pipeline: validate → assemble (mocked) → verify artifacts → reload indexes.
2. Artifact reload after rebuild.
3. Emulator IPC handshake against mock TCP server.
4. Debug session launch with fixture artifacts and mock emulator.
5. Breakpoint rebinding after simulated rebuild.

### 5.3 Regression Tests (behavior-preservation)

1. Multiple `*.project.json` selection.
2. Missing tool binary on build.
3. Missing `*.symbols.json` after reported success.
4. Stale artifacts after source edit.
5. Breakpoint restore after rebuild changes addresses.
6. Emulator panel reconnect after process restart.
7. `*.debug.json` round-trip: save → reload → verify.

### 5.4 Test Infrastructure

- Framework: Mocha + Chai (standard for VS Code extensions).
- Fixtures: `test/fixtures/` with sample project files, symbols files, ROM stubs.
- Mocks: `test/` helpers for process runner, file system, IPC server.
- CI script: `npm run test` runs all unit + integration + regression.

---

## 6. Documentation Plan

Each milestone updates docs before marking complete.

| Document | Created | Updated |
|----------|---------|---------|
| `docs/project-file.md` | M1 | M4 (templates) |
| `docs/debug-state-file.md` | M1 | M6, M7 |
| `docs/building.md` | M2 | M7 (hot-reload) |
| `docs/tool-setup.md` | M2 | — |
| `docs/artifacts.md` | M3 | — |
| `docs/project-creation.md` | M4 | — |
| `docs/editor-features.md` | M4 | M7 (runtime hovers) |
| `docs/emulator.md` | M5 | M7 |
| `docs/troubleshooting.md` | M5 | M8 |
| `docs/debugging.md` | M6 | M7 |
| `docs/advanced-debugging.md` | M7 | — |
| `README.md` (root) | M1 | Each milestone |

---

## 7. Risk Controls

| Risk | Countermeasure |
|------|---------------|
| Architecture drift / monolith regrowth | Keep `extension.ts` as composition root only; review imports across domains in each PR |
| Stale artifact bugs | Always reload after build; track freshness explicitly; regression tests for stale indexes |
| Tool contract changes | Typed adapter request objects; normalize tool output immediately; adapter-level tests |
| Debug state corruption | Persist logical breakpoints only; rebind on session start and after rebuild; validate `debug.json` on load |
| UI logic capturing core behavior | Keep panel code passive; put business logic in services with tests; exchange only typed messages |
| IPC performance (frame streaming) | Use `GET_FRAME_RAW` for binary transport; throttle frame requests; measure and tune in M8 |

---

## 8. Immediate Next Step

Begin **Milestone 1, PR 1**:

1. Initialize `package.json` with extension manifest.
2. Create `src/` directory tree.
3. Implement `extension.ts` composition root stub.
4. Implement platform utilities: logging, errors, process runner, path service.
5. Set up Mocha test infrastructure with first unit tests.

This establishes the foundation that all subsequent milestones build upon.
