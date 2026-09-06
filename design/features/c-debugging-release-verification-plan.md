# C Debugging Release Completion Plan

**Status:** Planned
**Date:** 2026-09-05
**Owners:** v6vscode maintainers (consumer and documentation), v6llvmc maintainers (producer and compiler verification), v6emul maintainers (server and sanitizer verification)
**Related work:** [C Debugging Implementation Roadmap](c-debugging-and-call-stack-plan.md), [DWARF Metadata Consumer](c-debug-dwarf-metadata-plan.md), [Semantic Call Stack](c-debug-call-stack-plan.md), [Variables and Expressions](c-debug-variables-and-expressions-plan.md), [Source Stepping](c-debug-source-stepping-plan.md)

Checkboxes: `[x]` complete; `[~]` partially implemented; `[ ]` not complete.

## 1. Objective

Close the four cross-cutting acceptance gates left by the C debugging roadmap: protect existing ASM and line-table-only C debugging, collect verifiable producer/consumer/emulator evidence, publish an optimization compatibility matrix, and align user, developer, architecture, and template documentation.

The outcome is a reproducible release record. It must distinguish behavior verified in this repository from evidence that must be produced by the v6llvmc and v6emul repositories.

## 2. Problem

### Current behavior

The detailed DWARF, Call Stack, variables, and source-stepping plans are implemented and their focused runners pass. `test:feature:metadata` verifies final `demo2` artifacts, while `test:feature:debug` rebuilds the O0/O1/O2 C probe and runs real Extension Host plus emulator scenarios.

The roadmap's final gates remain incomplete: `test/regression/baseline.test.ts` is only a runner placeholder, no public optimization compatibility matrix exists, `docs/development.md` incorrectly says the real-emulator runner is unimplemented, and sanitizer evidence belongs to native producer/emulator repositories rather than this TypeScript extension.

### Desired behavior

Baseline ASM and ordinary line-table C debugging have explicit regression and Extension Host coverage. The published matrix names the tested compiler/emulator versions, fixture hashes, optimization levels, supported behavior, and intentionally unsupported/metadata-dependent cases. The roadmap can be checked off only with retained evidence from every owner.

### Root cause

The detailed implementation plans focused on feature construction. They did not own the final cross-repository release gate or assign its evidence to individual repositories.

## 3. Strategy

### Approach

1. Add deterministic v6vscode regression tests for source breakpoint resolution and instruction-granularity stepping using the existing ASM-compatible debug index APIs and a line-table-only C artifact.
2. Extend the real Extension Host runner with an explicit ASM/incomplete-C-metadata machine-step scenario. It must demonstrate that statement granularity falls back honestly and instruction granularity remains one machine instruction.
3. Make metadata and debug feature runners self-describing: record compiler version and fixture hashes, and fail before assertions when required artifacts or metadata are missing.
4. Publish a compatibility matrix in `docs/debugging.md` and a maintainer procedure in `docs/development.md`. The matrix reports observed behavior only; it never claims support for unverified optimization levels or absent metadata.
5. Collect externally owned producer and sanitizer evidence as versioned text under `test/features/` only after the corresponding maintainers provide their actual commands and passing output. Do not invent v6llvmc Rust or v6emul CMake/sanitizer commands in this repository.

### Why this works

The baseline guardrails exercise the same public DAP/debug-index paths that C debugging extended, while the existing real-emulator runner validates integration. Separating external evidence prevents the extension plan from claiming compiler or native-memory safety it cannot execute.

### Ownership and Evidence

| Gate | Owner | Required evidence |
|------|-------|-------------------|
| ASM and baseline C compatibility | v6vscode | Focused regression tests and a passing real Extension Host scenario |
| Parser, adapter, Extension Host, metadata consumer | v6vscode | `npm run ci`, `npm run test:feature:metadata`, and `npm run test:feature:debug` results |
| Final ELF producer contract | v6llvmc | Versioned producer test output, compiler version, and documented emitted DWARF/CFI contract |
| Debugger server and sanitizer verification | v6emul | Versioned CTest/server-debug output and the actual AddressSanitizer command/result |
| Compatibility matrix and extension docs | v6vscode | Published matrix linked to artifact hashes and external evidence versions |

## 4. Implementation Steps

### Step 4.1 - Define release evidence inputs [ ]

Add `test/features/c-debug-release/evidence.md` as the checked-in evidence template. It must contain separate sections for v6vscode, v6llvmc, and v6emul; tool/version fields; exact commands; result file paths; fixture hashes; and an explicit `not provided` state. Do not mark unavailable external evidence as passed.

Update `test/features/README.md` to define this evidence file as the cross-repository companion to per-runner `result.txt` files.

> **Design Notes**: The template records provenance without coupling the extension build to a sibling repository layout.
>
> **Implementation Notes**:

### Step 4.2 - Add baseline regression coverage [ ]

Replace the placeholder `test/regression/baseline.test.ts` with focused baseline contracts:

- ASM source breakpoint resolution and address-to-source navigation remain available without semantic DWARF scopes.
- A line-table-only C artifact can resolve source breakpoints and source locations when optional scopes, locations, inline metadata, and CFI are unavailable.
- DAP instruction-granularity Step Into executes exactly one `EXECUTE_INSTR`; instruction Step Over retains the existing `GET_STEP_OVER_ADDR` fallback.
- Missing semantic metadata never prevents the baseline machine-step path from executing.

Use deterministic in-memory metadata or existing parser fixtures for unit/regression cases; do not depend on ignored build outputs. Extend `test/unit/debug/v6-debug-adapter.test.ts` only where its fake IPC client is needed to assert exact command routing.

> **Design Notes**: These are compatibility tests, not another semantic stepping implementation. They must fail if later C-debugging changes regress the pre-existing paths.
>
> **Implementation Notes**:

### Step 4.3 - Add real Extension Host fallback scenarios [ ]

Extend `src/test/integration/suite/` and `test/features/debug-adapter/run.ps1` with stable scenario IDs for:

- ASM or line-table-only artifact source breakpoint and instruction stepping.
- C launch with incomplete semantic metadata that retains source breakpoint and instruction-level fallback behavior.

The fixture must be tracked under `test/fixtures/`; generated ELF/ROM outputs must stay ignored. If no final linked artifact can honestly represent incomplete semantic metadata, stop and document that limitation rather than stripping metadata or weakening the assertion.

The runner must rebuild its tracked recipes, fail explicitly when an input is unavailable, and update `test/features/debug-adapter/result.txt` only after every scenario passes.

> **Design Notes**: The real scenario protects the Extension Host and DAP boundary that pure adapter tests cannot cover.
>
> **Implementation Notes**:

### Step 4.4 - Publish the V6C optimization compatibility matrix [ ]

Add a `C Debugging Compatibility Matrix` section to `docs/debugging.md` and a maintainer-oriented version/history table to `docs/development.md`.

For each available optimization level (`-O0`, V6C's documented debug-friendly level if it exists, `-O1`, `-O2`), record:

- Fixture source and exact compiler invocation.
- Compiler version and ELF/ROM SHA-256 hashes.
- Source breakpoint relocation behavior.
- Line/range/discriminator behavior.
- Variables, inactive ranges, and optimized-out values.
- Physical and inline Call Stack behavior.
- C expression support at verified locations.
- Source Step Into, Over, and Out behavior.
- Known metadata-dependent limitations.

Populate a cell only from a passing final linked ELF plus a matching feature result. Use `not verified` for unavailable levels. The matrix must link to `test/features/debug-metadata/result.txt`, `test/features/debug-adapter/result.txt`, and `test/features/c-debug-release/evidence.md`.

> **Design Notes**: A support matrix is a compatibility statement, so it must be traceable to immutable inputs and not inferred from source-level expectations.
>
> **Implementation Notes**:

### Step 4.5 - Align user, developer, architecture, and template documentation [ ]

Update the following from verified behavior only:

- `docs/debugging.md`: baseline fallback guarantees and matrix interpretation.
- `docs/development.md`: correct real-emulator runner status, `V6C` requirement for the tracked probe recipes, evidence collection procedure, and current test commands.
- `docs/architecture.md`: baseline line-table path remains independent of optional semantic DWARF data.
- `docs/commands.md`: instruction-granularity fallback availability.
- C project templates and their tests only if inspection finds debug compiler flags or artifact companion settings inconsistent with the verified V6C contract. Do not change generated template behavior merely to mention a matrix.
- `design/features/c-debugging-and-call-stack-plan.md`: link this release plan and assign the final checklist items to their evidence sources.

> **Design Notes**: Template changes are conditional. Documentation should not create a compiler requirement for ordinary C project creation unless the template already needs it.
>
> **Implementation Notes**:

### Step 4.6 - Collect external producer and sanitizer evidence [ ]

Request and record the following from the owning repositories:

- **v6llvmc**: final linked-ELF producer tests across the matrix levels, V6C version/commit, and the frozen ABI/DWARF contract revision.
- **v6emul**: CTest/server-debug tests, debugger protocol version, emulator version/commit, and the actual native sanitizer command with a clean result.

Copy only concise, reproducible command/result summaries into `test/features/c-debug-release/evidence.md`; link to permanent upstream CI runs or commit hashes when available. If an owner cannot provide a result, leave that gate unchecked and state the blocker in the roadmap.

> **Design Notes**: Sanitizer verification is intentionally an external deliverable because this repository contains TypeScript and cannot validate native compiler/emulator memory safety.
>
> **Implementation Notes**:

### Step 4.7 - Verify v6vscode release gates [ ]

Run and retain the exact results after Steps 4.1-4.5:

```powershell
npm run compile
npm run lint
npm run test:unit
npm run test:regression
npm run test:all
npm run test:feature:metadata
npm run test:feature:debug
npm run package
```

Confirm `git diff --check` is clean. Confirm generated fixture outputs are ignored while every fixture source and build recipe is tracked. Confirm `result.txt` files were written only by completely passing runners.

> **Implementation Notes**:

### Step 4.8 - Close the master roadmap [ ]

Mark each final checklist item in `design/features/c-debugging-and-call-stack-plan.md` `[x]` only when its row in the ownership table has the required evidence. Change the roadmap status from `Proposed` to `Implemented` only when all four items are complete.

If external producer or sanitizer evidence remains unavailable, retain `[ ]`, set roadmap status to `Partially Implemented`, and list the precise owner/blocker. Do not declare the cross-repository C-debugging roadmap complete based solely on v6vscode tests.

> **Implementation Notes**:

## 5. Test Strategy

- **Unit**: preserve exact DAP command routing for ASM and metadata-incomplete C; keep semantic DWARF tests independent of ignored generated files.
- **Regression**: replace the placeholder baseline test with source/address resolution and instruction fallback contracts.
- **Extension Host**: test source breakpoint and instruction fallback on a tracked baseline fixture.
- **Feature conformance**: `test:feature:metadata` validates final ELF/ROM source mapping; `test:feature:debug` validates real emulator behavior at all fixture optimization levels.
- **External verification**: v6llvmc and v6emul owners supply actual producer/server/sanitizer commands and results. No external result is inferred from a successful extension run.

## 6. Expected Results

### Baseline compatibility

A semantic DWARF regression cannot remove ASM or line-table-only C breakpoints, source navigation, or machine-level stepping without failing a dedicated test.

### Honest optimization support

Users and maintainers can see which behaviors are verified at each optimization level and which depend on producer metadata, rather than assuming source-level correspondence after optimization.

### Auditable release closure

The master roadmap names evidence for every cross-repository gate. An unavailable native sanitizer run remains visible as a blocker instead of being silently treated as complete.

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| No honest incomplete-metadata final artifact exists | Stop Step 4.3, document the missing producer fixture, and keep its gate unchecked. |
| V6C has no separate debug-friendly optimization level | Publish `not provided by V6C`; do not substitute an arbitrary flag. |
| Native sanitizer commands differ by repository or platform | Record only commands run by the v6emul/v6llvmc owners with their toolchain/version. |
| Fixture binaries accidentally become tracked | Retain targeted ignore rules and verify `git status --untracked-files=all test/fixtures`. |
| Result hashes become stale after a fixture change | Delete result files before changes and rerun their complete feature runners. |

## 8. Documentation Updates

- `docs/debugging.md`: compatibility matrix, fallback behavior, and limitations.
- `docs/development.md`: V6C fixture prerequisite, real-emulator runner status, cross-repository evidence procedure.
- `docs/architecture.md`: baseline-versus-semantic metadata boundary.
- `docs/commands.md`: instruction fallback behavior.
- `test/features/README.md`: evidence template/result retention policy.
- `design/features/c-debugging-and-call-stack-plan.md`: link this plan, owners, and closure status.

## 9. Relationship to Other Improvements

This plan does not replace the five completed C-debugging subplans. It supplies the release-level verification and documentation work required to close their shared parent roadmap. It also establishes a reusable pattern for future protocol/compiler features that span the extension and native repositories.

## 10. Future Enhancements

- Automate cross-repository evidence collection in coordinated CI once stable upstream artifact publishing exists.
- Add matrix coverage for mixed C/ASM, headers, macros, and multi-translation-unit programs when producer fixtures become available.
- Add debugger scenario result schema validation in CI.

## 11. References

- [C Debugging Implementation Roadmap](c-debugging-and-call-stack-plan.md)
- [C Debug DWARF Metadata Consumer Plan](c-debug-dwarf-metadata-plan.md)
- [C Debug Call Stack Plan](c-debug-call-stack-plan.md)
- [C Debug Variables and Expressions Plan](c-debug-variables-and-expressions-plan.md)
- [C Debug Source Stepping Plan](c-debug-source-stepping-plan.md)
- [Debugging Guide](../../docs/debugging.md)
- [Development Guide](../../docs/development.md)
- [Feature Verification Policy](../../test/features/README.md)
