# C Source-Level Stepping Implementation Plan

**Status:** Implemented
**Date:** 2026-08-15
**Owner:** v6vscode maintainers
**Prerequisites:** `c-debug-dwarf-metadata-plan.md`, `c-debug-call-stack-plan.md`
**Related roadmap:** `c-debugging-and-call-stack-plan.md`

Checkboxes: `[x]` complete; `[~]` partially implemented; `[ ]` not complete.

## 1. Problem

Current Step Into executes one machine instruction. Current Step Over uses the backend's next instruction address. These operations are useful for ASM but do not implement C source semantics.

C stepping must account for:

- Source lines with no emitted instructions.
- Multiple lines mapped to one instruction.
- One line mapped to multiple machine ranges.
- Physical calls and returns.
- Inline logical frames.
- Inlined header/runtime code.
- Discontinuous optimized ranges.
- Tail calls and optimized-away statements.

Step Out is unavailable because no verified caller resume PC currently exists.

## 2. Scope

In scope:

- Source Step Into, Step Over, and Step Out.
- Logical source and frame identity.
- Inline-frame stepping.
- Temporary breakpoint ownership and cleanup.
- User breakpoint/watchpoint/exception precedence.
- Instruction and time budgets.
- Optimized-code behavior and source filters.
- Explicit instruction-granularity fallback.

Out of scope:

- Reverse stepping.
- Guessing return addresses without verified unwind state.
- Reconstructing source statements absent from DWARF.

## 3. Logical Location Model

Define:

```ts
interface LogicalLocation {
  physicalFrameId: string;
  inlineChain: InlineFrameId[];
  file: string;
  line: number;
  column: number;
  discriminator?: number;
  isStmt: boolean;
}
```

A source step completes at a distinct logical location under the operation's frame-depth policy, not after an arbitrary instruction count.

Statement indexes must expose all machine ranges for one logical statement and all candidate next statements inside function and inline ranges.

## 4. Stop Precedence

Before step-completion logic, preserve these stops:

1. User breakpoint.
2. Watchpoint/data breakpoint.
3. Exception or backend fault.
4. Script-requested break.
5. User pause.
6. Halt or emulator termination.

An internal temporary breakpoint must never mask or replace a user breakpoint at the same address. Hit attribution remains stable.

## 5. Source Step Into

Step Into must stop at the first of:

- A distinct statement in the same physical/inline frame.
- Entry into a physical C callee with source.
- Entry into a new inline logical frame.
- A higher-priority stop reason.

Algorithm:

1. Capture starting logical location and semantic frame depth.
2. Determine candidate statement and call-entry addresses.
3. Use temporary breakpoints when candidates are known; otherwise use bounded instruction stepping.
4. Ignore non-statement rows and repeated mappings to the same logical location.
5. Re-evaluate semantic frame state after each internal stop.

DAP instruction granularity continues to execute one instruction.

## 6. Source Step Over

Step Over remains at the starting semantic frame depth.

- Advance through all machine ranges belonging to the current statement.
- Stop at the next distinct statement in the same physical/inline frame.
- If a physical call executes, use the verified caller resume PC as a candidate after-return stop.
- Do not stop inside a deeper physical callee unless a user breakpoint or higher-priority stop fires.
- Apply the documented policy when entering a deeper inline frame.

Backend `GET_STEP_OVER_ADDR` remains the instruction-level fallback, not the semantic C algorithm.

## 7. Source Step Out

Advertise Step Out only after the semantic Call Stack can provide verified frame relationships.

Inline Step Out:

- Exit to the containing inline or concrete frame.
- Use inline ranges and containing-frame next statements.
- Do not change physical stack depth.

Physical Step Out:

- Use the selected frame's verified resume PC.
- Install an owned temporary breakpoint without replacing a user breakpoint.
- Resume until return or a higher-priority stop.
- Reject the outermost or unverifiable frame with `No verified caller frame`.

Tail-called frames with no return edge must not receive a fabricated resume address.

## 8. Optimized C Policy

The debugger follows emitted DWARF:

- A non-executable line relocates to the next emitted statement in the same file.
- Several source lines may share one address.
- One statement may have multiple discontinuous address ranges.
- Inlined code may legitimately open a header source.
- A step may jump over removed statements.
- Tail calls may remove a physical caller.

Do not force one-stop-per-source-line behavior that the compiler metadata cannot support.

## 9. Source Filters

Add an optional setting for source Step Into/Over filtering, for example runtime headers or compiler support sources.

Rules:

- Filters affect stepping targets only.
- Call Stack remains truthful and continues to show filtered frames.
- User breakpoints in filtered sources still stop.
- Default behavior is to enter all source-bearing C frames.
- Matching uses normalized paths and documented glob semantics.

## 10. Temporary Breakpoint Ownership

Represent internal step breakpoints separately from user breakpoints.

Requirements:

- Reference-count or share backend addresses without changing user configuration.
- Remove temporary ownership on completion, cancellation, error, pause, reset, reload, disconnect, or termination.
- Preserve conditions, hit counters, and logpoints owned by users.
- Attribute stops correctly when user and temporary ownership share an address.

## 11. Budgets and Cancellation

Every semantic step has:

- Maximum internal instructions.
- Maximum elapsed time.
- Maximum candidate/temporary breakpoints.
- Cancellation on a new execution-control request.
- Cleanup in every success and failure path.

Return actionable errors:

- `No new source statement before halt`.
- `Source step exceeded the instruction budget`.
- `Selected frame has no verified caller`.
- `Source metadata is unavailable at the current PC`.

## 12. Service Architecture

Extract:

```text
source-step-service.ts      semantic step state machine
step-breakpoint-store.ts    temporary ownership and cleanup
logical-location-index.ts   statement ranges and candidates
```

The service consumes immutable metadata, stopped-generation Call Stack state, backend execution controls, stop records, and user breakpoint ownership.

## 13. Tests

Unit tests:

- Repeated instructions on one source line.
- Two lines sharing one address.
- One line with discontinuous ranges.
- Physical call Step Into/Over/Out.
- Nested inline Step Into/Over/Out.
- Tail call with no return edge.
- Filtered runtime source.
- Shared user and temporary breakpoint address.
- Breakpoint, watchpoint, exception, script, pause, and halt precedence.
- Cancellation, timeout, budget exhaustion, and cleanup.

Real Extension Host plus emulator tests:

- Step Into enters a known C callee.
- Step Over remains in the caller.
- Step Out stops at the caller continuation.
- Inline frames behave according to policy under optimization.
- A missing source row jumps honestly to the next emitted statement.
- ASM instruction stepping remains unchanged.

Run at `-O0`, debug-friendly optimization if defined, `-O1`, and `-O2`.

## 14. Acceptance Gates

- C source steps complete on logical locations, not arbitrary instructions.
- User stop reasons always take precedence.
- Step Out uses only a verified caller resume PC.
- Temporary breakpoints never overwrite user breakpoint state.
- Every internal path is bounded and cleans up.
- Optimized stepping matches emitted line, range, inline, and unwind metadata.
- Instruction-level ASM behavior remains available.

## 15. Implementation Steps

### Step 15.1 - Build the logical location index [x]

Add `src/debug/adapter/logical-location-index.ts`, backed by the immutable line-table rows and `DebugMetadataIndex` scope/range queries. Define `LogicalLocation`, stable statement identity, and half-open machine ranges. The index must resolve the current PC to a logical location; enumerate every range of its statement; and return next distinct statement candidates constrained by physical-frame PC range and inline-chain policy.

Extend `src/debug/metadata/debug-index.ts` only with immutable, normalized statement-row enumeration required to construct the index. Do not change `resolveBreakpoint`, `resolveBreakpointAll`, or instruction navigation behavior.

Add `test/unit/debug/logical-location-index.test.ts` covering repeated instruction rows, two source lines at one address, discriminator/column distinctions, discontinuous statement ranges, non-statement rows, and no-next-statement cases.

> **Design Notes**: A `(file, line, column, discriminator, physicalFrameId, inlineChain)` identity prevents a source step from completing merely because the PC moved within another instruction range for the same statement.
>
> **Implementation Notes**: Added immutable normalized `statementRows` to `DebugIndex` and `LogicalLocationIndex` for grouping locations by frame, inline chain, file, line, and column. Focused unit coverage verifies repeated rows, discontinuous ranges, inline distinctions, and non-statement skipping; compile and lint pass.

### Step 15.2 - Add owned temporary breakpoint storage [x]

Add `src/debug/adapter/step-breakpoint-store.ts`. It must separately track user ownership and one-or-more semantic-step owners for each 16-bit address, reconcile backend `DEBUG_BREAKPOINT_ADD` / `DEBUG_BREAKPOINT_DEL` requests without overwriting a user configuration, and report whether a stop address has user ownership, temporary ownership, or both.

Replace the adapter's `pendingStepOverAddr` add/delete pair in `src/debug/adapter/v6-debug-adapter.ts` with this store for the existing `GET_STEP_OVER_ADDR` instruction-level path. Retain `__dap_next` only as the backend tag convention, not as the ownership model. Ensure reset, reload, disconnect, termination, cancellation, and every normal stop release temporary owners.

Add `test/unit/debug/step-breakpoint-store.test.ts` for shared user/temporary addresses, multiple temporary owners, backend add/delete failures, idempotent release, and cleanup. Extend `test/unit/debug/breakpoint-reconciliation.test.ts` only for the adapter integration contract.

> **Design Notes**: A temporary breakpoint is an execution aid. It must not replace a user condition, counter, logpoint, or visible breakpoint ID at the same CPU address.
>
> **Implementation Notes**: Added `StepBreakpointStore` with separate user and reference-counted temporary ownership, idempotent release, backend-failure handling, and focused unit tests. The existing instruction-level Step Over now uses the store. Removing user ownership restores any sharing temporary backend breakpoint.

### Step 15.3 - Implement a bounded semantic-step state machine [x]

Add `src/debug/adapter/source-step-service.ts` as a pure orchestration service. Its input is a captured stopped generation, `LogicalLocationIndex`, selected `DapFrameContext`, and callbacks for candidate breakpoint ownership, `RUN`, and one-instruction execution. Its output is `continue`, `complete`, or an actionable failure.

Represent the operation kind (`into`, `over`, `out`), starting logical location, starting physical and inline depth, candidate addresses, and cancellation token. Enforce named constants for maximum candidate breakpoints, internal instructions, and elapsed time. Re-evaluate the captured logical/frame state after each internal stop; ignore non-statement and repeated logical locations; and guarantee disposal of acquired temporary owners from `finally` paths.

Add `test/unit/debug/source-step-service.test.ts` with deterministic fake callbacks for candidate selection, repeated mappings, candidate-limit fallback, instruction-budget exhaustion, elapsed-time exhaustion, cancellation, and cleanup after success/error.

> **Design Notes**: The service does not decode DAP messages or read mutable adapter fields. This keeps stop classification and cleanup testable without an Extension Host.
>
> **Implementation Notes**: Added `SourceStepService` with logical-location and physical/inline-depth completion rules, cancellation cleanup, and instruction/time/candidate limits. Focused tests cover repeated mappings, Step Into/Over/Out depth policy, limits, metadata-unavailable instruction fallback, and cleanup.

### Step 15.4 - Route C Step Into while preserving instruction stepping [x]

In `src/debug/adapter/v6-debug-adapter.ts`, inspect the DAP `stepIn` granularity and use `SourceStepService` only for statement/source granularity when a current logical location and semantic frame are available. Use candidate statement and physical-call/inline-entry addresses first, then bounded `EXECUTE_INSTR` fallback. Keep the existing one-instruction `EXECUTE_INSTR` behavior for instruction granularity, ASM sessions, missing metadata, and unsupported semantic frames.

Capture the selected stopped frame through `StackTraceService.frame()` and use its physical frame plus inline DIE identity to initialize the source-step state. Return `Source metadata is unavailable at the current PC` only for an explicit source-granularity request that has no honest fallback; otherwise retain the existing machine-step behavior.

Extend `test/unit/debug/v6-debug-adapter.test.ts` and `test/unit/debug/stop-record-adapter.test.ts` to prove source Step Into advances to a distinct statement or source-bearing callee, while instruction Step Into still sends exactly one `EXECUTE_INSTR`.

> **Implementation Notes**: Added metadata-backed statement-granularity routing that uses logical next-statement candidates and falls back to instruction stepping when metadata is absent or instruction granularity is requested. Stop handling re-evaluates logical locations after internal stops. Adapter routing tests and real-emulator source Step Into coverage pass.

### Step 15.5 - Route C Step Over across calls and inline frames [x]

Extend `SourceStepService` and adapter routing for source-granularity `next`. Advance through every range of the current statement and complete only at a next distinct statement at the starting semantic depth. Use the verified caller continuation from `DapFrameContext.physicalFrame.returnPc` as an after-call candidate; never use `GET_STEP_OVER_ADDR` as a semantic result. Retain `GET_STEP_OVER_ADDR` plus the temporary store as the machine-step fallback.

Define and document the initial inline policy: Step Over skips a deeper inline logical frame and completes at the next statement in the starting inline frame; Step Into may complete at the deeper inline frame. Unit-test this policy against nested inline chains and optimized discontinuous ranges.

Add cases to `test/unit/debug/source-step-service.test.ts` and adapter tests for physical callees, inline callees, tail calls with no continuation, and the current statement spanning discontinuous ranges.

> **Implementation Notes**: Added source-granularity candidate routing and retained the original `GET_STEP_OVER_ADDR` instruction fallback. Step Over filters candidate targets and the real emulator scenario confirms it remains in `accumulate`; optimized O1/O2 relocation and inline coverage pass.

### Step 15.6 - Gate and implement source Step Out [x]

Advertise `supportsStepOut` only when the current stopped generation contains a selected semantic frame with a verified caller relationship. Add the adapter `stepOut` route:

- For an inline frame, target the containing inline/concrete frame's next distinct statement without changing physical depth.
- For a physical frame, use only `physicalFrame.returnPc` as the owned temporary candidate and complete after the return.
- Reject the outermost or unverifiable physical frame with `Selected frame has no verified caller`.

Add inline and physical Step Out coverage to `test/unit/debug/source-step-service.test.ts`, including tail-call/no-return-edge rejection and stale stopped-generation frames. Extend `test/unit/debug/stack-trace-service.test.ts` only when an explicit caller-relationship accessor is required.

> **Implementation Notes**: Added DAP `stepOut` dispatch that accepts only a selected generation-bound semantic frame with a verified physical `returnPc`; otherwise it reports `Selected frame has no verified caller`. Inline Step Out targets the next statement outside the selected inline DIE, with focused adapter coverage and a passing optimized inline real-emulator scenario.

### Step 15.7 - Centralize authoritative stop precedence and competing-control cancellation [x]

Refactor `onStop()` in `src/debug/adapter/v6-debug-adapter.ts` so a `StopRecord` is classified before semantic-step completion. Preserve, in this order: user breakpoint, watchpoint/data breakpoint, exception/fault, script break, user pause, halt/termination, then internal semantic-step completion. At an address shared by user and temporary owners, emit the user breakpoint's DAP ID and cancel/release the semantic operation.

Cancel an active source step before `continue`, `pause`, a new step request, reset, ROM reload, disconnect, and termination. Centralize cleanup through the source-step service and temporary store; no handler may directly delete a semantic breakpoint. Preserve the existing logpoint automatic-resume behavior only when the stop is attributed to a user logpoint.

Extend `test/unit/debug/stop-record-adapter.test.ts` with all precedence cases and `test/unit/debug/v6-debug-adapter.test.ts` with competing execution-control cancellation and no leaked backend breakpoints.

> **Implementation Notes**: User breakpoint/logpoint, watchpoint, exception, script, and pause records cancel a semantic step before internal completion is examined. Focused adapter and stop-record tests pass; reset/reload/disconnect invoke centralized source-step cancellation and ownership cleanup.

### Step 15.8 - Add source filters and debugger settings [x]

Add documented debugger configuration settings in `package.json` and identifiers in `src/config/contribution-ids.ts` for source-step filter glob patterns and the three safety limits (instruction count, elapsed milliseconds, candidate breakpoints). Resolve and validate them once per debug session in `v6-debug-adapter.ts` using normalized paths and `minimatch` only if it is already a direct project dependency; otherwise use VS Code's available glob matcher or add a small tested matcher dependency.

Pass the filter predicate only to `SourceStepService` candidate selection. Do not remove filtered sources or frames from `StackTraceService`, alter user source breakpoints, or filter an explicitly requested Step Out destination.

Add configuration parsing tests in `test/unit/debug/v6-debug-adapter.test.ts` and source-filter behavior tests in `test/unit/debug/source-step-service.test.ts`.

> **Implementation Notes**: Added contributed source-step filter and safety-limit settings plus centralized identifiers. Runtime consumption resolves settings per source step; normalized glob matching filters both Step Over candidates and instruction-progressed Step Into stops. Focused adapter coverage verifies filtered target selection.

### Step 15.9 - Add optimized fixtures and feature-conformance scenarios [x]

Create a reproducible C debug probe under `test/fixtures/cdbg/` that produces `probe-O0.elf` and `probe-O0.rom`, then extend its build recipe and `test/features/debug-adapter/run.ps1` with stable scenario IDs for source Step Into entering `add8`, Step Over staying in `accumulate`, and physical Step Out stopping at its verified continuation. Add optimized (`-O1` and `-O2`) scenarios for a missing source row relocating to the next emitted statement, discontinuous line ranges, and the documented inline policy when the compiler emits inline metadata.

The runner must skip no assertions: it fails explicitly when `V6EMUL`, the required C compiler, generated ELF, or required metadata is unavailable. Delete a prior `test/features/debug-adapter/result.txt` before fixture/assertion changes and recreate it only after all scenarios pass with version, scenario ID, and artifact hash data.

Add deterministic unit fixtures for all parser-independent edge cases rather than relying on mutable `temp/` build outputs.

> **Implementation Notes**: Added tracked O0/O1/O2 probe recipes that use `V6C` with the Vector-06c target, while generated artifacts remain ignored. The feature runner requires all three ROM/ELF pairs and records their hashes. Real Extension Host plus emulator scenarios issue source `stepIn`, `stepOut`, and `next` requests against O0, relocate omitted source lines at O1/O2, and Step Into/Out nested O2 inline frames. Deterministic real-ELF tests verify O1/O2 inline scopes and discontinuous statement mappings.

### Step 15.10 - Document, compile, lint, and verify [x]

Update `docs/debugging.md` with source versus instruction granularity, Step Into/Over/Out semantics, verified-caller gating, filters, budgets, cancellation, shared-breakpoint precedence, and optimized-code limitations. Update `docs/settings.md`, `docs/commands.md`, and `docs/architecture.md` with new settings, DAP capability behavior, and the three source-stepping services.

Run the validation sequence after all implementation steps:

```powershell
npm run compile
npm run lint
npm run test:unit
npm run test:regression
npm run test:all
npm run test:feature:metadata
npm run test:feature:debug
```

The feature runner rebuilds `Makefile.O0`, `Makefile.O1`, and `Makefile.O2` from `test/fixtures/cdbg` before testing; it fails explicitly if any tracked recipe is absent or does not produce its expected artifacts. Confirm `$env:V6EMUL` is a full executable path. `test:feature:debug` is gated and passes against a real emulator.

> **Implementation Notes**: Updated debugging, settings, commands, and architecture documentation. `npm run compile`, `npm run lint` (warnings only), `npm run test:unit` (504 passing), `npm run test:regression` (62 passing), `npm run test:all`, `npm run test:feature:metadata`, and `npm run test:feature:debug` pass. The real-emulator runner verifies O0 source Step Into/Over/Out, O1/O2 omitted-line relocation, and nested O2 inline Step Into/Out.

## 16. Test Strategy

Each implementation step runs `npm run compile`, `npm run lint`, and its named focused Mocha test before its checkbox is marked complete. The final unit suite must cover logical-location equality, source candidate selection, physical and inline frame-depth policies, shared breakpoint ownership, all stop precedence branches, cancellation, every cleanup trigger, limits, filters, tail calls, and instruction-granularity fallback.

Run `npm run test:regression` and `npm run test:all` after all steps. Run `npm run test:feature:metadata` after fixture changes, and run gated `npm run test:feature:debug` at `-O0`, the project's debug-friendly optimization mode if available, `-O1`, and `-O2` when `V6EMUL` and the C toolchain are configured. Keep `test/features/debug-adapter/result.txt` only after every feature assertion succeeds.

## 17. Documentation Updates

- `docs/debugging.md`: source-step semantics, fallbacks, verified Step Out, filters, and optimized-code behavior.
- `docs/settings.md`: source-step filters and safety-limit defaults/ranges.
- `docs/commands.md`: DAP source/instruction granularity and Step Out availability.
- `docs/architecture.md`: ownership of `LogicalLocationIndex`, `StepBreakpointStore`, and `SourceStepService`.