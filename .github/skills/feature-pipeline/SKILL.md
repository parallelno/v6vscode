---
name: feature-pipeline
description: 'Multi-stage, test-driven feature development pipeline: prepare & plan → PAUSE for review → implement in build/test cycles → verify & analyze → complete. Use when: the user asks to develop or implement a new feature or optimization end-to-end, wants a feature implementation plan, or invokes the feature pipeline. Produces a design plan, runs implementation cycles with builds and tests, and writes a result.txt comparison. DO NOT USE FOR: one-line bug fixes, refactors with no behavior change, or answering questions about a feature.'
argument-hint: 'Optional: path to a feature description file, or a short feature name'
user-invocable: true
---

# Feature Development Pipeline

A disciplined, end-to-end workflow for adding a new feature or optimization to an
existing codebase. Each phase must complete before the next begins. The workflow is
**test-driven** and **pause-gated**: it stops for human review before any code is written.

The pipeline is workspace-agnostic. Concrete commands, paths, and tool names are
**discovered in Phase 0** from the current workspace — never assumed from memory.

---

## When to Use
- The user asks to "develop / implement / build a new feature" or "add an optimization" end-to-end.
- The user points at a feature description and wants it turned into a plan and shipped.
- The user invokes `/feature-pipeline`.

## When NOT to Use
- A single-line fix, a rename, or a refactor with no behavior change (just do it).
- Answering a question about how a feature works (read the code, don't run the pipeline).
- Work that is already mid-flight with an existing plan (resume that plan instead).

## Inputs
- **Feature description** — a file (e.g. under `design/`) or a short prose description.
  If the user passes an argument, treat it as the feature name or the path to the
  description file. If neither is given, ask for it before starting.

---

## Phase 0 — Workspace Binding (do this first, every time)

Before anything else, discover the concrete facts of **this** workspace so the later
phases use real commands and paths instead of guesses. Record them in a short
"Workspace Binding" note (in the plan file, or in session memory) and reuse them.

Discover by reading, not by assuming:

| Fact | How to find it |
|------|----------------|
| Build command | `package.json` scripts, `Makefile`, `CMakeLists.txt`, or a build guide under `docs/` |
| Unit / lit test command | `package.json` scripts (e.g. `test:unit`, `test:feature:*`), test runner config |
| Full regression command | `package.json` scripts, `tests/run_all.py`, CI config |
| Plan location & naming | existing plans under `design/` (e.g. `design/plan.md`, `design/features/*-plan.md`) |
| Feature backlog / status | a README or index under `design/` that tracks what is done vs. in progress |
| Result file location & policy | `test/features/README.md` or a `result.md` describing the expected `result.txt` |
| Mirror / sync step | a sync script under `scripts/` (only if one actually exists) |
| Reference tooling (emulator, assembler, etc.) | `tools/` CLI docs, or the `V6EMUL` / `V6ASM` env vars used by test runners |

**Rules for Phase 0:**
- If a referenced file does not exist, **do not invent it**. Note it as "not present in
  this workspace" and skip that step, or ask the user how to proceed.
- Prefer the authoritative source (`package.json`, the actual test runner) over a
  prose doc when they disagree.
- Keep the binding note small: one line per fact.

---

## Phase 1 — Preparation

1. Read the feature description to understand the problem and the proposed solution.
2. Read the feature backlog / status index (from Phase 0) to see what is already done.
3. Read the build guide / relevant docs for build commands, tool paths, and any sync
   procedure.
4. Explore the relevant parts of the codebase to verify the proposed solution is
   feasible. Use a read-only subagent for broad exploration to keep the main thread
   focused.
5. Create the implementation plan using the **Plan Format** below. Save it to the plan
   location from Phase 0 (e.g. `design/plan_<feature_name>.md`).
6. Set up the test scaffolding described by the workspace's test README (e.g.
   `test/features/README.md`): create the test folder, baseline inputs, and any
   reference artifacts the verification step needs.
7. Report to the user what was produced: the plan file path, the test folder, and the
   baseline artifacts.

---

## Phase 2 — Pause (hard gate)

**STOP and wait for the user.** Do not write any implementation code yet.

Present a concise review summary:
- The plan file path and a one-paragraph summary of the approach.
- The test cases / baseline artifacts that were created.
- Any open questions or assumptions that need confirmation.

Then explicitly ask the user to review and give the go-ahead. **Do not proceed to
Phase 3 until the user approves.** This pause is intentional — it is the cheapest
moment to catch a wrong direction.

---

## Phase 3 — Implementation Cycles

Repeat the following cycle for **each step** in the plan's Implementation Steps.
Work one step at a time; do not batch.

### Build cycle (per plan step)
1. Implement the next plan step (modify the source files as the step describes).
2. Build using the build command from Phase 0.
3. If the build fails, diagnose and fix, then rebuild. Do not move on until it builds.
4. Mark the plan step complete (`[x]`).
5. Fill in the step's **Implementation Notes** with what was actually done and any
   deviations from the plan.
6. Move to the next plan step.

### Tests (after each meaningful code change)
1. Run the relevant unit / lit test for the step (from Phase 0).
2. If a test fails, diagnose and fix, then rebuild and rerun.

**Guardrails:**
- Keep changes scoped to the current step. If a step reveals the plan is wrong, stop
  and update the plan (and tell the user) before continuing.
- Never leave a step marked `[x]` while its build or test is red.

---

## Phase 4 — Verification & Analysis

Enter this phase only after **all** implementation steps are complete.

1. Run the full regression suite (command from Phase 0).
2. If anything fails, diagnose, fix, rebuild, and rerun until green.
3. Run the feature's verification workflow from the workspace test README (e.g.
   compile the feature test case, produce the reference assembly, and compare).
   Iterate on the implementation if the output does not meet the design expectation.
4. Explain the resulting output to the user, highlighting the concrete improvement
   (e.g. cycle savings, code-size delta, correctness).
5. Perform the mirror / sync step **only if** such a script exists in this workspace
   (see Phase 0). If it does not exist, skip it and say so.
6. Produce the result file (e.g. `result.txt`) per the **Result Policy** below.

---

## Phase 5 — Completion

1. Confirm every plan step is marked `[x]` in the plan file.
2. Mark the feature complete in the backlog / status index (set `[x]`).
3. Update any affected documentation under `docs/`.
4. Report the final results to the user: the measured improvement, code-size delta,
   and the status of unit / integration / regression tests.

---

## Plan Format

The plan file must contain, at minimum, these sections (adapt the wording, keep the
structure). Use `[ ]` / `[x]` checkboxes on every implementation step.

```markdown
# <Feature Name> — Implementation Plan

Reference: <link to the feature description>

## 1. Problem
### Current behavior
### Desired behavior
### Root cause

## 2. Strategy
### Approach
### Why this works
### Summary of changes

## 3. Implementation Steps
### Step 3.1 — <what> [ ]
<step details>
> **Design Notes**: <why, if non-obvious>
> **Implementation Notes**: <empty; filled after completion>

### Step 3.N — Build [ ]
### Step 3.N+1 — Unit / lit test: <name> [ ]
### Step 3.N+2 — Run regression tests [ ]
### Step 3.N+3 — Verification (per test README) [ ]
### Step 3.N+4 — Write result file (per Result Policy) [ ]
### Step 3.N+5 — Sync mirror (only if a sync script exists) [ ]

## 4. Expected Results
### Example 1 — how this benefits the project
### Example 2 — ...

## 5. Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| ...  | ...        |

## 6. Relationship to Other Improvements
## 7. Future Enhancements
## 8. References
```

**Plan rules:**
- Begin by reading the reference documents; do not plan from memory.
- Every step must be concrete enough to execute without re-reading the whole design.
- Conclude with expanded test coverage (unit, integration, regression).
- Include result verification against the design expectation.
- Require the corresponding documentation updates.
- Mark sections and steps complete as they are done — the plan is the source of truth
  for progress.

---

## Result Policy

Applies to any `result.txt` (or equivalent) the verification step produces.

- Commit / keep a result file **only after every assertion in that feature runner
  passes**. A failed or partial run must not update the file.
- Do **not** include timestamps, temporary ports, or absolute machine-specific paths.
- **Do** include producer / tool versions when available, the passed scenario IDs, and
  artifact hashes (e.g. SHA-256) so results are reproducible and comparable.
- Delete a stale result file before changing assertions or fixtures, so an old pass is
  never mistaken for a current one.
- For compiler / codegen features, the result should contain: the input source, the
  reference output, the old output, the new output, and a comparison table (e.g. CPU
  cycles and byte length per function) across the reference, old, and new.

---

## Anti-patterns (avoid these)
- **Skipping the pause.** Never start implementation before the user approves the plan.
- **Hardcoded paths.** Do not assume `scripts/sync_*.ps1`, `tests/run_all.py`, or
  `tools/*/cli.md` exist — discover them in Phase 0 and skip gracefully if absent.
- **Batching steps.** One plan step per build/test cycle; mark it done only when green.
- **Trusting a stale result.** Re-run verification after any code change; delete stale
  result files before changing fixtures.
- **Silent scope creep.** If a step reveals the plan is wrong, update the plan and tell
  the user before continuing.

---

## References (resolve via Phase 0, do not assume)
- Feature description file (user-provided or under `design/`).
- Feature backlog / status index under `design/`.
- Build guide under `docs/` (if present).
- Test workflow and result policy: `test/features/README.md` (or the workspace equivalent).
- An existing completed plan as a format example (e.g. `design/plan.md`).
