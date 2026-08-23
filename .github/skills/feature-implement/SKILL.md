---
name: feature-implement
description: 'Implement an already-planned feature in the v6vscode VS Code extension (Vector-06c) using a test-driven build/test cycle per plan step. Use when: the user asks to implement, build, or ship a feature that already has an approved design/features/<name>-plan.md, or invokes /feature-implement. Reads the plan, works one step at a time (compile → unit test → mark done), then runs regression, feature conformance, and writes result.txt. DO NOT USE FOR: creating a new plan (use feature-plan), one-line bug fixes, or answering questions.'
argument-hint: 'Optional: the feature name, or a path to the plan file (design/features/<name>-plan.md)'
user-invocable: true
---

# Feature Implementation (v6vscode)

Act as an experienced engineer responsible for execution. Take an **approved
implementation plan** for the **v6vscode** VS Code extension (the Vector-06c
development environment) and implement it **test-driven, one plan step at a time**,
until every step is green and the feature is verified.

This skill **implements**. It reads the plan, modifies `src/`, runs builds and tests,
and updates the plan's checkboxes as it goes. It does **not** design a new plan — if
no approved plan exists, hand off to the `feature-plan` skill first.

---

## When to Use
- The user asks to "implement / build / ship" a feature that already has a plan.
- The user points at a `design/features/<name>-plan.md` and wants it executed.
- The user invokes `/feature-implement`.

## When NOT to Use
- No approved plan exists yet → use `feature-plan` to produce one first.
- A one-line fix or a rename with no behavior change → just do it.
- Answering "how does X work?" → read the code, don't implement.

## Inputs
- **The plan file** — `design/features/<feature_name>-plan.md`. If the user passes an
  argument, treat it as the feature name (resolve to `design/features/<name>-plan.md`)
  or a direct path. If no plan can be found, **stop and ask** the user to run
  `feature-plan` first — do not invent a plan here.

---

## Project Facts (v6vscode)

Ground every action in these real facts. Do not invent paths or commands.

**What it is:** A TypeScript VS Code extension for the Vector-06c retro computer —
project management, Intel 8080 syntax highlighting, `v6emul` emulator integration, a
DAP debug adapter, and a family of standalone webview panels (Hex Viewer, Memory
Edits, Performance, Trace Log, Scripts, Symbols, Ports, Watchpoints, Hardware
Statistics).

**Layered architecture** (see `docs/architecture.md`):
- `src/platform/` — infrastructure (logger, typed errors, path/workspace services, process runner, disposables). No domain logic.
- `src/config/` — `contribution-ids.ts` (command IDs, setting keys), JSON schema.
- `src/project/` — `*.project.json` discovery, parsing, validation, persistence, active-project.
- `src/language/` — TextMate grammar, `language-services.ts` shared presentation API.
- `src/emulator/` — launcher, protocol (MessagePack over TCP), client, lifecycle, panel.
- `src/debug/` — DAP adapter, metadata, and one service + provider + webview per panel.
- `src/extension.ts` — composition root only.

**Build & test commands** (from `package.json`):
| Purpose | Command |
|---------|---------|
| Compile | `npm run compile` |
| Lint | `npm run lint` |
| Unit tests | `npm run test:unit` |
| Regression | `npm run test:regression` |
| Integration | `npm run test:integration` |
| Feature: metadata conformance | `npm run test:feature:metadata` |
| Feature: real-emulator DAP (gated) | `npm run test:feature:debug` |
| All (unit + regression) | `npm run test:all` |
| CI (compile + lint + test:all) | `npm run ci` |
| Package `.vsix` | `npm run package` |

**Test layout:**
- Unit tests: `test/unit/**/*.test.ts`, run by Mocha (`.mocharc.yml`). `test/register.js`
  bootstraps `ts-node` with `tsconfig.test.json` and provides a **mock `vscode` module**
  so unit tests run outside the Extension Host.
- Regression: `test/regression/**/*.test.ts` (run with `--no-config --require ./test/register.js`).
- Feature runners: `test/features/<area>/run.ps1` (PowerShell). Result policy in
  `test/features/README.md`.
- Fixtures: `temp/project/` — build with `make` there to produce `out/demo1.elf` /
  `out/demo1.rom` (and `demo2.*`). Rebuild the fixture when the source it compiles changes.

**External tools** (not bundled; see `docs/development.md`):
- `v6emul` — Vector-06c emulator. Resolved **only** from the `V6EMUL` env var (full path).
  The only tool the extension launches directly. Required for `test:feature:debug`.
- `v6asm` — Intel 8080 assembler (via `PATH` or `V6ASM`). Used by generated Makefiles.
- `v6fdd` — FDD image builder (via `PATH` or `V6FDD`).
- `v6c` — C compiler (optional).

**Panel implementation shape** (most features follow this): a `*-service.ts`
(EventEmitter, IPC + mutation orchestration, immutable snapshots, session generation),
a `*-panel.ts` / `*-provider.ts` (WebviewPanel lifecycle + message validation), a
`*-messages.ts` (webview↔host union types), and webview assets under
`src/debug/views/assets/`. Wiring touches `src/config/contribution-ids.ts`,
`src/emulator/protocol/*` (models, `ipc-commands.ts`, `ipc-server-info.ts`),
`src/emulator/panel/emulator-panel-launcher-view.ts`, `src/extension.ts`, and
`package.json` (commands, menus, context keys).

**Docs to keep in sync:** `docs/` (architecture, debugging, emulator, commands,
settings, language-support, project-system, development).

---

## Procedure

### 0. Load the plan (never implement from memory)
- Read the full plan file. Confirm it has an **Implementation Steps** section with
  `[ ]` / `[x]` checkboxes and a **Test Strategy** naming the exact `npm run ...`
  commands.
- Identify the starting point: the first step that is **not** marked `[x]`. Resume
  there; do not redo completed steps.
- If the plan references a `v6emul` protocol change, note the required command IDs,
  schema version, and advertised limits — you will validate against them.
- If the plan is missing, ambiguous, or has no checkboxes, **stop and ask** the user
  to run `feature-plan`. Do not proceed on guesses.

### 1. Prepare the environment (once, before the first step)
- `npm install` if `node_modules` is absent.
- If the feature's tests depend on `temp/project` artifacts and the source changed,
  rebuild the fixture: `Set-Location temp/project; make`.
- If a step needs the real emulator, confirm `V6EMUL` is set to a full path. If it is
  not set, note it and defer the gated `test:feature:debug` step rather than guessing.

### 2. Implement in build/test cycles (one plan step at a time)
Repeat for **each** remaining step in the plan's Implementation Steps. Work one step
at a time; do not batch.

1. Implement the step (add/change the files the step names). Keep the change scoped to
   that step.
2. **Compile:** `npm run compile`. If it fails, diagnose and fix, then recompile. Do
   not move on until it compiles.
3. **Lint:** `npm run lint`. Fix any new findings in the files you touched.
4. **Test:** run the step's named test (usually `npm run test:unit`, or a targeted
   `mocha` invocation for a single spec). If a test fails, diagnose and fix, then
   recompile and rerun.
5. **Mark the step done** — set its checkbox to `[x]` in the plan file.
6. **Fill in the step's Implementation Notes** with what was actually done and any
   deviation from the plan.
7. Move to the next step.

**Guardrails:**
- Never leave a step marked `[x]` while its compile, lint, or test is red.
- If a step reveals the plan is wrong, **stop**, update the plan (and tell the user)
  before continuing. Silent scope creep is a defect.
- Follow the existing code's conventions. For a new panel, mirror the closest existing
  panel (e.g. Memory Edits or Watchpoints) for the service/provider/webview split,
  message types, polling, and stale-generation rejection.

### 3. Verification (after all steps are `[x]`)
1. **Regression:** `npm run test:regression`. If anything fails, diagnose, fix,
   recompile, and rerun until green.
2. **Full suite:** `npm run test:all` (unit + regression) to confirm no cross-feature
   breakage.
3. **Feature conformance:** run the feature's runner, e.g.
   `npm run test:feature:metadata`. For a real-emulator scenario, set `V6EMUL` and run
   `npm run test:feature:debug`. Iterate on the implementation if the output does not
   meet the design expectation.
4. **Result file:** write the feature's `result.txt` (e.g.
   `test/features/<area>/result.txt`) **only after every assertion in that runner
   passes** — see the **Result Policy** below.
5. **Explain the outcome** to the user, highlighting the concrete improvement
   (correctness, cycle/size delta, new capability) and the status of each test tier.

### 4. Completion
1. Confirm **every** plan step is `[x]` in the plan file.
2. Update the plan's **Status** header (e.g. `Planned` → `Implemented`) and fill any
   remaining Implementation Notes.
3. Update the affected `docs/` pages named in the plan's Documentation Updates section.
4. Report the final results: the measured outcome, and the status of unit,
   regression, and feature tests.

---

## Result Policy

Applies to any `result.txt` a feature runner produces (carried from
`test/features/README.md`):
- Commit / keep a `result.txt` **only after every assertion in that feature runner
  passes**. A failed or partial run must not update the file.
- Do **not** include timestamps, temporary ports, or absolute machine-specific paths.
- **Do** include producer / emulator versions when available, the passed scenario IDs,
  and artifact hashes (e.g. SHA-256) so results are reproducible and comparable.
- Delete a stale result file before changing assertions or fixtures, so an old pass is
  never mistaken for a current one.

---

## Anti-patterns (avoid these)
- **Implementing without a plan.** No approved `design/features/<name>-plan.md` → run
  `feature-plan` first.
- **Batching steps.** One plan step per compile/lint/test cycle; mark it `[x]` only
  when green.
- **Trusting a stale result.** Re-run verification after any code change; delete stale
  `result.txt` before changing fixtures.
- **Skipping the fixture rebuild.** If the compiled source changed, `make` in
  `temp/project` before metadata/DAP conformance.
- **Guessing the emulator path.** `test:feature:debug` needs `V6EMUL` set to a full
  path; if unset, defer and say so rather than inventing one.
- **Silent scope creep.** If a step reveals the plan is wrong, update the plan and tell
  the user before continuing.
- **Diverging from house style.** New panels must follow the existing
  service + provider + webview split and reuse the shared lifecycle, protocol, and
  navigation utilities.

---

## References
- The approved plan: `design/features/<name>-plan.md` (source of truth for steps and
  test commands).
- `docs/architecture.md` and the doc(s) for the area being touched.
- `test/features/README.md` — feature runner prerequisites and `result.txt` policy.
- `test/register.js` and `.mocharc.yml` — how unit tests bootstrap and mock `vscode`.
- A recently implemented panel under `src/debug/` as the concrete pattern to mirror.
