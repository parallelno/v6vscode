# v6vscode Design

## 1. Purpose

`v6vscode` is a VS Code extension that provides an integrated development environment for Vector-06C software development.

The extension is responsible for editor integration, project orchestration, debugging UX, and communication with external tools. It is not responsible for implementing an assembler, floppy image builder, or emulator core internally. Those remain standalone tools stored under `tools/` and invoked through stable adapter layers.

This document defines the target architecture, storage model, extension boundaries, testing strategy, and an incremental implementation plan focused on long-term maintainability.

## 2. Goals

### 2.1 Product Goals

1. Provide high-quality assembly editing support for Vector-06C projects.
2. Make project creation, build, run, and debug available directly inside VS Code.
3. Integrate emulator execution into a dedicated VS Code view without embedding emulator logic in the extension.
4. Surface registers, breakpoints, source mapping, and runtime inspection through standard VS Code debugging experiences.
5. Treat generated artifacts as first-class project state so the extension can rebuild, reload, and debug reliably.
6. Keep the codebase modular enough that additional features can be added without creating cross-module coupling.

### 2.2 Engineering Goals

1. Keep extension code organized by domain, not by feature accretion.
2. Separate pure logic from VS Code API glue wherever possible.
3. Define strict interfaces around external tools and generated artifacts.
4. Make the system testable at unit, integration, and regression levels.
5. Ensure every milestone ends with updated tests and updated documentation.

## 3. Non-Goals

1. Reimplement `v6asm`, `v6fdd`, or `v6emul` in TypeScript.
2. Couple extension internals to undocumented behavior of external tools.
3. Put all runtime state into VS Code workspace settings.
4. Build a one-off prototype optimized for short-term delivery at the expense of maintainability.

## 4. Guiding Principles

### 4.1 Clear Ownership

Each subsystem must own one concern:

1. Language features own source analysis and editor affordances.
2. Project services own project discovery, validation, and persistence.
3. Build services own tool invocation and artifact refresh.
4. Debug services own runtime state translation between files, addresses, and VS Code debug APIs.
5. Webview services own emulator presentation only.

### 4.2 Artifact-Driven Design

The extension should derive behavior from explicit files instead of hidden memory state.

1. `*.project.json` stores durable project configuration and references to build artifacts.
2. `*.rom` and `*.symbols.info` are the authoritative build outputs used for run/debug flows.
3. `*.debug.json` stores session runtime debug state such as breakpoints, watchpoints, and debugger preferences.

### 4.3 Reload Instead of Cache Guessing

On run, rebuild, restart, or artifact change, the extension should reload `*.rom` and `*.symbols.info` from disk and rebuild in-memory indexes. This avoids subtle stale-state bugs.

### 4.4 Testable by Default

Parsing, path resolution, source mapping, breakpoint mapping, and debug-state persistence must be implemented in testable modules with minimal VS Code dependencies.

## 5. Core Artifacts

### 5.1 `*.project.json`

This file is the root of project orchestration. It stores:

1. Project identity.
2. Entry assembly file.
3. Output locations.
4. References to generated `*.rom` and `*.symbols.info` files.
5. Optional FDD configuration.
6. Emulator launch preferences.

Proposed shape:

```json
{
  "$schema": "./schemas/v6.project.schema.json",
  "name": "demo",
  "asmEntry": "src/main.asm",
  "build": {
    "rom": "out/demo.rom",
    "symbols": "out/demo.symbols.info",
    "listing": "out/demo.lst",
    "cpu": "i8080",
    "romAlign": 2
  },
  "disk": {
    "enabled": true,
    "template": "${extension}/res/fdd/rds308.fdd",
    "output": "out/demo.fdd",
    "content": [
      "out/demo.rom"
    ]
  },
  "run": {
    "launchTarget": "rom",
    "bootRom": "${extension}/res/boot/boot.txt",
    "speed": "1x",
    "viewMode": "fit"
  }
}
```

Notes:

1. The design should keep the schema explicit and versionable.
2. Paths may be relative to the project file.
3. `${extension}` is resolved by the extension at runtime for bundled assets.

### 5.2 `*.symbols.info`

This is a generated artifact produced by the assembler and treated as a required input for rich editor and debugger behavior.

It should contain enough information for:

1. Symbol lookup.
2. Address-to-source mapping.
3. Source-to-address mapping.
4. Include relationships.
5. Breakpoint-capable lines.
6. Label and constant definitions.

The extension must not assume ad hoc parsing rules spread across multiple modules. A single parser and normalized in-memory model must own this format.

### 5.3 `*.debug.json`

This is runtime session state managed by the extension, not by the assembler.

It should store:

1. User breakpoints and enabled state.
2. Watchpoints.
3. Memory watches.
4. Last selected launch target.
5. Optional debugger UI state such as memory panel preferences.

This file should be safe to delete and regenerate. It is convenience state, not a build artifact.

## 6. System Context

```text
ASM files in workspace
  -> language services
  -> project discovery
  -> build orchestration
  -> v6asm
  -> .rom + .symbols.info
  -> artifact indexing
  -> debug session / emulator launch
  -> v6emul + webview + VS Code debug APIs
```

External tools:

1. `tools/v6asm/` compiles assembly and emits project artifacts.
2. `tools/v6fdd/` creates FDD images from a template and project outputs.
3. `tools/v6emul/` runs the emulator backend and exposes an IPC protocol.

The extension must wrap these tools through adapters so the rest of the codebase depends on stable TypeScript interfaces instead of process details.

## 7. Proposed Repository Layout

The implementation should be organized around durable domains.

```text
v6vscode/
  src/
    extension.ts
    platform/
      logging/
      errors/
      process/
      files/
      events/
    config/
      contribution-ids.ts
      schemas/
    project/
      model/
      discovery/
      parsing/
      validation/
      persistence/
    artifacts/
      model/
      symbols/
      rom/
      cache/
    tools/
      common/
      v6asm/
      v6fdd/
      v6emul/
    build/
      pipeline/
      diagnostics/
      tasks/
    language/
      navigation/
      includes/
      symbols/
      hovers/
      definitions/
      references/
      breakpoints/
    debug/
      adapter/
      session/
      registers/
      breakpoints/
      watchpoints/
      sourcemap/
      state/
    emulator/
      client/
      protocol/
      panel/
      viewmodel/
      assets/
    commands/
      create-project/
      build-project/
      run-project/
      rebuild-disk/
    templates/
      project/
      asm/
    test-support/
      fixtures/
      mocks/
      builders/
  test/
    unit/
    integration/
    regression/
    fixtures/
  docs/
  design/
  res/
  tools/
```

Rules for this layout:

1. VS Code API usage should be pushed to the edge of the system.
2. Parsing and model code should not depend on webview or debug session code.
3. External process launching should be centralized under `src/tools/`.
4. Shared path and workspace utilities should live under `src/platform/`, not be duplicated per feature.

## 8. Module Architecture

### 8.1 Extension Composition Root

`src/extension.ts` should only:

1. Construct services.
2. Register VS Code contributions.
3. Dispose resources.

It should not contain project logic, parsing, process invocation, or debug flow logic inline.

### 8.2 Project Domain

Responsibilities:

1. Discover `*.project.json` files in the workspace.
2. Parse and validate project files.
3. Resolve relative and extension-bundled paths.
4. Expose the active project selection service.
5. Persist updates when commands create or edit project files.

Key interfaces:

```ts
interface ProjectDiscoveryService {
  findProjects(): Promise<ProjectFile[]>;
}

interface ProjectRepository {
  load(uri: vscode.Uri): Promise<V6Project>;
  save(project: V6Project): Promise<void>;
}

interface ActiveProjectService {
  getActiveProject(context?: ProjectContextHint): Promise<V6Project | undefined>;
}
```

### 8.3 Artifact Domain

Responsibilities:

1. Parse `*.symbols.info`.
2. Load ROM metadata needed for run/debug commands.
3. Build normalized indexes for address and symbol lookup.
4. Invalidate and rebuild indexes when outputs change.

Key interfaces:

```ts
interface ArtifactIndexService {
  load(project: V6Project): Promise<ProjectArtifacts>;
  reload(project: V6Project): Promise<ProjectArtifacts>;
}

interface SymbolsInfoParser {
  parse(text: string): SymbolsInfoModel;
}
```

### 8.4 Tool Adapter Domain

Each external tool gets its own adapter package with:

1. Binary discovery.
2. Command construction.
3. Version probing.
4. Process execution.
5. Structured result mapping.

Example interfaces:

```ts
interface AssemblerTool {
  assemble(request: AssembleRequest): Promise<AssembleResult>;
  getVersion(): Promise<string>;
}

interface DiskTool {
  buildDisk(request: BuildDiskRequest): Promise<BuildDiskResult>;
}

interface EmulatorTool {
  launch(request: LaunchEmulatorRequest): Promise<EmulatorProcessHandle>;
}
```

These adapters shield the rest of the system from CLI flag changes and process details.

### 8.5 Build Pipeline Domain

The build pipeline owns the sequence:

1. Resolve project.
2. Validate project paths.
3. Run `v6asm`.
4. Verify `.rom` and `.symbols.info` existence.
5. Reload artifacts.
6. Optionally run `v6fdd`.
7. Publish diagnostics and build summary.

Build results should be represented as structured objects, not passed around as raw terminal text.

### 8.6 Language Domain

Responsibilities:

1. Definitions for labels and includes.
2. Document links.
3. Hover information.
4. Breakpoint-capable line resolution.
5. Workspace symbol support where feasible.

Navigation strategy:

1. Include links should be resolved directly from source text.
2. Label navigation should prefer current artifact indexes.
3. If indexes are stale or unavailable, the UX should degrade predictably and explain that a build is required.

### 8.7 Debug Domain

The debug domain is the center of runtime coordination.

Responsibilities:

1. Translate VS Code debug requests to emulator IPC commands.
2. Translate source breakpoints to emulator addresses using `*.symbols.info`.
3. Keep `.debug.json` synchronized with user actions.
4. Expose registers, stack, memory, and execution location.
5. Rebind source mappings after rebuild or rerun.

This domain should remain independent from webview rendering.

### 8.8 Emulator UI Domain

The emulator panel is a consumer of runtime state, not the source of truth.

Responsibilities:

1. Render video frames.
2. Forward input actions.
3. Display status and memory views.
4. Reflect session state already owned by debug/session services.

The panel should use a thin message bridge and a typed view model.

## 9. External Tool Integration

### 9.1 Tool Discovery

Tool resolution order:

1. Explicit path from extension settings, if configured.
2. Bundled tool path inside `tools/`.
3. User `PATH` fallback, if supported.

The extension should validate tool presence early and produce actionable errors.

### 9.2 Tool Contracts

The extension should define minimal contracts for each tool.

`v6asm` contract:

1. Accept input source and output paths.
2. Emit `*.rom` and `*.symbols.info`.
3. Produce parseable stderr/stdout diagnostics.

`v6fdd` contract:

1. Accept a template disk image.
2. Accept a project-defined content set.
3. Emit a deterministic FDD image.

`v6emul` contract:

1. Start as a process controlled by the extension.
2. Accept launch parameters pointing to ROM or FDD targets.
3. Provide request-response IPC for debug and rendering.

### 9.3 Failure Handling

Tool failures should be classified:

1. Configuration errors.
2. Missing executable errors.
3. Non-zero exit build failures.
4. Artifact mismatch errors.
5. Emulator launch or handshake errors.

This classification is important for diagnostics, UX, and automated tests.

## 10. Build and Artifact Lifecycle

### 10.1 Build Flow

```text
Select project
  -> validate configuration
  -> run v6asm
  -> confirm .rom and .symbols.info
  -> parse artifacts
  -> optionally run v6fdd
  -> refresh indexes
  -> publish diagnostics
```

### 10.2 Rebuild Semantics

A rebuild must:

1. Re-run the assembler.
2. Re-read `*.rom` and `*.symbols.info` from disk.
3. Replace the in-memory artifact index atomically.
4. Notify debug and language services that address mappings may have changed.

### 10.3 Artifact Freshness

The extension should detect and explain these states:

1. No build artifacts exist yet.
2. Build artifacts exist but are older than source files.
3. Artifacts are loaded but invalid for the selected project.
4. Runtime session is using artifacts older than the current project state.

## 11. Debugging Architecture

### 11.1 Debug Model

The extension should implement a VS Code debug adapter model that maps Vector-06C execution concepts onto the standard VS Code debugger surface.

Core capabilities:

1. Launch.
2. Continue.
3. Pause.
4. Step in.
5. Step over.
6. Restart.
7. Registers.
8. Breakpoints.
9. Watchpoints if exposed through custom requests or UI.

### 11.2 Source Mapping

Source mapping uses `*.symbols.info` as the canonical source of truth.

Required indexes:

1. `address -> source location`
2. `source location -> address`
3. `symbol -> definition`
4. `file -> breakpoint-capable lines`

If the current PC has no source mapping, the debugger should still expose:

1. Current address.
2. Raw opcode bytes if available.
3. A clear indication that no source mapping exists.

### 11.3 Breakpoints

Breakpoint flow:

1. User toggles a breakpoint in an ASM file.
2. Extension resolves the current project.
3. Extension translates file and line to one or more target addresses.
4. Extension stores the logical breakpoint in `*.debug.json`.
5. Active debug session pushes the concrete address breakpoint to `v6emul`.

This distinction between logical and bound breakpoints is important because addresses may change after rebuild.

### 11.4 Watches and Memory Inspection

The design should support:

1. Expression watches based on symbols.
2. Raw memory watches based on addresses.
3. Register views.
4. Stack preview.
5. Memory dump navigation.

### 11.5 Runtime State Persistence

`*.debug.json` should persist runtime intent, not raw emulator internals.

Persist:

1. Logical breakpoints by file and line.
2. Watchpoints by semantic description.
3. Memory view preferences.

Do not persist:

1. Transient process IDs.
2. Socket ports.
3. Raw frame buffers.
4. Non-portable absolute paths if relative paths can be used.

## 12. Emulator Panel Design

### 12.1 Responsibilities

The emulator panel should provide:

1. Video output.
2. Runtime controls.
3. Hardware status summary.
4. Memory dump tools.
5. Optional future debug visualizations.

### 12.2 Boundaries

The panel must not:

1. Parse `*.symbols.info` itself.
2. Own breakpoint binding logic.
3. Own process lifecycle decisions independently.

### 12.3 View Model

The webview should receive typed messages such as:

```ts
type EmulatorPanelMessage =
  | { type: 'frame'; width: number; height: number; pixels: Uint8Array }
  | { type: 'status'; running: boolean; speed: string; frameNum: number }
  | { type: 'memory'; start: number; bytes: number[]; pc?: number }
  | { type: 'error'; message: string };
```

This keeps the UI implementation replaceable without changing debug logic.

## 13. Language Features

### 13.1 Syntax Highlighting

Use the existing grammar at `res/syntaxes/devector_8080.tmLanguage.json`.

The grammar remains a resource concern. Semantic behavior such as navigation and hover is implemented separately in TypeScript.

### 13.2 Hyperlink Navigation

Support:

1. Include paths.
2. Global labels.
3. Local labels where resolution is unambiguous.
4. Constants defined in loaded symbols metadata.

### 13.3 Hover Behavior

Hover content should be layered:

1. Static symbol information from `*.symbols.info`.
2. Runtime value information when a debug session is paused.
3. Graceful fallback when runtime state is unavailable.

### 13.4 References and Rename

These may start as limited-scope features. The initial design should allow future addition, but the first milestones should not force premature complexity if symbol metadata is insufficient.

## 14. Configuration Model

### 14.1 Extension Settings

Global extension settings should cover only environment-level configuration:

1. Optional override paths for tools.
2. Logging verbosity.
3. Default project template settings.
4. Emulator UI defaults that are not project-specific.

Project-specific behavior belongs in `*.project.json`, not global settings.

### 14.2 Schemas and Validation

Provide JSON schemas for:

1. `*.project.json`
2. `*.debug.json`

Validation should run both:

1. At file load time.
2. Before build or launch.

## 15. Observability and Diagnostics

The extension should include:

1. Structured logs for tool invocation and debug lifecycle.
2. Output channels for user-visible build and emulator events.
3. Consistent error codes for test assertions.

Diagnostics sources:

1. Project validation diagnostics.
2. Assembler diagnostics.
3. Artifact parse diagnostics.
4. Emulator connection diagnostics.

## 16. Testing Strategy

The system must have a comprehensive test suite. This is a design requirement, not a later cleanup task.

### 16.1 Unit Tests

Unit tests should cover pure logic modules:

1. Project parsing and validation.
2. Path resolution.
3. `*.symbols.info` parsing.
4. Address-to-source and source-to-address mapping.
5. Breakpoint line eligibility.
6. `*.debug.json` persistence.
7. Tool command construction.
8. Emulator IPC message encoding and decoding.

### 16.2 Integration Tests

Integration tests should cover service boundaries:

1. Build pipeline calling `v6asm` and loading artifacts.
2. FDD pipeline calling `v6fdd`.
3. Debug session startup against a controllable emulator backend.
4. Artifact reload after rebuild.
5. Breakpoint rebinding after address changes.

### 16.3 Regression Tests

Regression tests should capture behavior that has broken before or is likely to break:

1. Multi-file include navigation.
2. Stale artifact invalidation.
3. Project selection with multiple `*.project.json` files.
4. Restart after rebuild.
5. Persistence and reload of breakpoints and watchpoints.

### 16.4 Webview and UI Tests

Use focused tests for:

1. Panel message handling.
2. Memory dump navigation behavior.
3. Basic control enable/disable states.

Avoid burying critical logic in UI code that can only be verified through end-to-end tests.

### 16.5 Milestone Definition of Done

Every milestone must end with all of the following:

1. Unit tests added or updated.
2. Regression tests added or updated.
3. All tests run.
4. Documentation updated in `docs/`.
5. Root `README.md` updated if user-facing behavior changed.

No milestone is complete without this work.

## 17. Delivery Plan

The scope is large, so the implementation must evolve in controlled stages.

### Milestone 1: Foundation

Deliver:

1. Extension scaffold and contribution registration.
2. Project discovery and validation.
3. JSON schemas for project and debug files.
4. Tool discovery and process abstraction.
5. Logging and diagnostics infrastructure.

Exit criteria:

1. A project file can be discovered and validated.
2. External tool presence can be verified.
3. Tests cover parsing, validation, and path resolution.

### Milestone 2: Build System

Deliver:

1. Build command.
2. `v6asm` adapter.
3. Artifact loading for `*.rom` and `*.symbols.info`.
4. Build diagnostics.
5. Optional `v6fdd` generation.

Exit criteria:

1. A project can build from VS Code.
2. Generated artifacts are indexed.
3. Rebuild refreshes in-memory indexes.

### Milestone 3: Language Features

Deliver:

1. Include navigation.
2. Symbol definition navigation.
3. Hover information from symbols metadata.
4. Breakpoint-capable line detection.

Exit criteria:

1. Rich editor navigation works for built projects.
2. Fallback behavior is clear when artifacts are missing.

### Milestone 4: Emulator Launch and Panel

Deliver:

1. `v6emul` adapter.
2. Emulator process lifecycle management.
3. Webview panel.
4. Frame rendering and runtime controls.

Exit criteria:

1. A ROM or FDD target launches from the extension.
2. The panel renders frames and exposes basic controls.

### Milestone 5: Debugger Integration

Deliver:

1. Debug adapter/session implementation.
2. Register display.
3. Breakpoint binding and persistence.
4. Source mapping during pause.
5. Memory dump integration.

Exit criteria:

1. Breakpoints work reliably across rebuild and restart.
2. Registers and current source location are visible in VS Code.

### Milestone 6: Advanced Debug UX

Deliver:

1. Watchpoints.
2. Symbol-aware watches.
3. Live hover values during pause.
4. Better breakpoint synchronization and session restoration.

Exit criteria:

1. Debug state round-trips through `*.debug.json`.
2. Runtime inspection is stable enough for day-to-day use.

### Milestone 7: Hardening

Deliver:

1. Performance tuning.
2. Error-handling cleanup.
3. Expanded regression suite.
4. Documentation pass.

Exit criteria:

1. Major workflows are covered by automated tests.
2. The codebase remains modular and reviewable.

## 18. Risks and Countermeasures

### 18.1 Risk: Architecture Drift

Countermeasure:

1. Keep module boundaries documented.
2. Reject convenience imports across domains.
3. Review new features against the domain layout.

### 18.2 Risk: Tool Contract Drift

Countermeasure:

1. Centralize command construction.
2. Add adapter tests against expected CLI behavior.
3. Probe versions and feature support explicitly.

### 18.3 Risk: Stale Artifact Bugs

Countermeasure:

1. Reload artifacts after build and run.
2. Replace indexes atomically.
3. Surface freshness state in logs and diagnostics.

### 18.4 Risk: Debug State Corruption

Countermeasure:

1. Store logical breakpoints, not bound addresses.
2. Rebind on session start and after rebuild.
3. Validate `*.debug.json` against schema.

### 18.5 Risk: UI Logic Capturing Core Behavior

Countermeasure:

1. Keep panel code passive.
2. Put business logic in services with tests.
3. Exchange typed messages only.

## 19. Documentation Requirements

The design assumes living documentation.

Required docs to maintain alongside implementation:

1. Root `README.md` for user-facing workflows.
2. `docs/` for project file schema, commands, debugger behavior, and troubleshooting.
3. `design/` for architecture decisions and evolution.

If a milestone changes behavior and documentation is not updated, the milestone is incomplete.

## 20. Summary

This design intentionally centers the extension around three stable foundations:

1. Explicit project configuration in `*.project.json`.
2. Explicit build artifacts in `*.rom` and `*.symbols.info`.
3. Explicit runtime session state in `*.debug.json`.

Everything else in the architecture follows from those decisions.

The extension should remain a well-structured orchestrator around editor features, project state, and external tools. It should not become a monolith that mixes parsing, process control, UI rendering, and runtime debugging into the same layer. If the implementation follows the module boundaries and milestone discipline defined here, the project can grow without repeating the structural problems of the previous design.