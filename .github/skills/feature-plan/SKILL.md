---
name: feature-plan
description: 'Create a maintainable, test-driven implementation plan for a new feature in the v6vscode VS Code extension (Vector-06c). Use when: the user asks to plan, design, or scope a new feature, panel, command, protocol change, or optimization for this project, or invokes /feature-plan. Produces a design/features/<name>-plan.md following the project plan format. This skill only PLANS — it does not write implementation code. DO NOT USE FOR: implementing an already-planned feature (use feature-implement), one-line bug fixes, or answering questions.'
argument-hint: 'Optional: a short feature name, or a path to a feature description file'
user-invocable: true
---

# Feature Plan (v6vscode)

Act as an experienced software architect responsible for execution. Produce a
**maintainable, test-driven implementation plan** for a new feature in the **v6vscode**
VS Code extension (the Vector-06c development environment).

This skill **only plans**. It reads the codebase, verifies feasibility, and writes a plan
file. It does **not** modify `src/`, run builds, or write tests. Hand off to the
`feature-implement` skill once the user approves the plan.

---

## When to Use
- The user asks to "plan / design / scope a new feature" for v6vscode.
- The user points at a feature description and wants it turned into a plan.
- The user invokes `/feature-plan`.

## When NOT to Use
- Implementing a feature that already has an approved plan → use `feature-implement`.
- A one-line fix or a rename with no behavior change → just do it.
- Answering "how does X work?" → read the code, don't plan.

## Inputs
- **Feature description** — a file (e.g. under `design/`) or a short prose description.
  If the user passes an argument, treat it as the feature name or the path to the
  description. If neither is given, ask for it before starting.

---

## Project Facts (v6vscode)

Ground every plan in these real facts. Do not invent paths or commands.

**What it is:** A TypeScript VS Code extension for the Vector-06c retro computer —
project management, Intel 8080 syntax highlighting, `v6emul` emulator integration, a
DAP debug adapter, and a family of standalone webview panels (Hex Viewer, Memory Edits,
Performance, Trace Log, Scripts, Symbols, Ports, Watchpoints, Hardware Statistics).

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

**External tools** (not bundled; see `docs/development.md`):
- `v6emul` — Vector-06c emulator. Resolved **only** from the `V6EMUL` env var (full path). The only tool the extension launches directly.
- `v6asm` — Intel 8080 assembler. Used by generated Makefiles via `PATH` (or `V6ASM`). Great for ASM syntax reference, intermediate ASM comparison, and ASM→ROM for tests.
- `v6fdd` — FDD image builder (via `PATH` or `V6FDD`).
- `v6c` — C compiler (optional).

**Key locations:**
- Plans: `design/features/<name>-plan.md` (see existing plans for the house style).
- Test fixtures: `temp/project/` (build with `make` there to produce `out/demo1.elf` / `out/demo1.rom`).
- Feature test runners: `test/features/<area>/run.ps1`; result policy in `test/features/README.md`.
- Docs to keep in sync: `docs/` (architecture, debugging, emulator, commands, settings, language-support, project-system, development).

---

## Procedure

### 1. Read the references first (never plan from memory)
- The feature description (user-provided or under `design/`).
- `docs/architecture.md` and the doc(s) for the area being touched.
- The relevant existing code under `src/` to confirm the proposed approach is feasible.
  Use a read-only subagent for broad exploration to keep the main thread focused.
- A recent `design/features/*-plan.md` as a format/style reference.

### 2. Verify feasibility
- Confirm the target layer, the IPC command IDs / schema version, and the server
  capabilities the feature depends on (many panels are gated on a `GET_SERVER_INFO`
  schema + command range — name them explicitly).
- If the feature depends on a `v6emul` protocol change, state the server contract and
  which commands/limits must be advertised.

### 3. Write the plan
Save it to `design/features/<feature_name>-plan.md` using the **Plan Format** below.

### 4. Report
Tell the user the plan file path, a one-paragraph summary of the approach, the test
strategy, and any open questions or assumptions. **Stop here** — do not implement.

---

## Plan Format

The plan must contain, at minimum, these sections (adapt wording, keep structure). Use
`[ ]` / `[x]` checkboxes on every implementation step.

```markdown
# <Feature Name> Plan

**Status:** Planned
**Date:** <YYYY-MM-DD>
**Related work:** <links to related plans / server contract docs>

## 1. Objective
<what the feature is and the user-visible outcome>

## 2. Problem
### Current behavior
### Desired behavior
### Root cause

## 3. Strategy
### Approach
### Why this works
### Summary of changes
<name the layer(s), IPC commands / schema version, and server capabilities involved>

## 4. Implementation Steps
### Step 4.1 — <what> [ ]
<concrete details: files to add/change under src/, the service + provider + webview split>
> **Design Notes**: <why, if non-obvious>
> **Implementation Notes**: <empty; filled after completion>

### Step 4.N — Compile [ ]
### Step 4.N+1 — Unit test: <name> [ ]
### Step 4.N+2 — Regression test [ ]
### Step 4.N+3 — Feature conformance (test/features/<area>/run.ps1) [ ]
### Step 4.N+4 — Write result.txt (per test/features/README.md policy) [ ]

## 5. Test Strategy
<unit, integration, and regression coverage; which npm scripts; which fixtures in temp/project>

## 6. Expected Results
### Example 1 — how this benefits the project
### Example 2 — ...

## 7. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| ...  | ...        |

## 8. Documentation Updates
<which docs/ pages change>

## 9. Relationship to Other Improvements
## 10. Future Enhancements
## 11. References
```

**Plan rules:**
- Begin by reading the reference documents; do not plan from memory.
- Every step must be concrete enough to execute without re-reading the whole design.
- Conclude with expanded test coverage (unit, integration, regression) and the exact
  `npm run ...` commands.
- Include result verification against the design expectation.
- Require the corresponding `docs/` updates.
- Mark sections and steps complete as they are done — the plan is the source of truth
  for progress (the `feature-implement` skill updates these checkboxes).

---

## Result Policy (for the plan's verification step)

Carried from `test/features/README.md`:
- Commit / keep a `result.txt` **only after every assertion in that feature runner passes**.
- No timestamps, temporary ports, or absolute machine-specific paths.
- Include producer/emulator versions when available, passed scenario IDs, and artifact
  hashes (e.g. SHA-256).
- Delete a stale result file before changing assertions or fixtures.

---

## Anti-patterns (avoid these)
- **Planning from memory.** Read the code and docs first; verify command IDs and schema
  versions against `src/emulator/protocol/` and the server contract.
- **Inventing paths/commands.** Use the real `npm run ...` scripts and `design/features/`
  location. If a referenced tool or doc is absent, say so.
- **Implementing here.** This skill stops at the plan. No `src/` edits, no builds.
- **Vague steps.** "Add a panel" is not a step; name the service, provider, webview,
  commands, and schema version.
