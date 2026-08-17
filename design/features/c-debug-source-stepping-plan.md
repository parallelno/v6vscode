# C Source-Level Stepping Implementation Plan

**Status:** Proposed
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

## 15. Implementation Checklist

- [ ] Build the logical location and statement-range index.
- [ ] Track starting physical and inline frame depth.
- [ ] Implement source Step Into candidate selection.
- [ ] Implement source Step Over across statements and calls.
- [ ] Implement inline Step Out.
- [ ] Implement physical Step Out from a verified resume PC.
- [ ] Preserve user breakpoint, watchpoint, exception, script, pause, and halt precedence.
- [ ] Add separate temporary breakpoint ownership.
- [ ] Guarantee cleanup on completion, cancellation, error, reset, reload, disconnect, and termination.
- [ ] Add instruction, time, and candidate limits.
- [ ] Add cancellation for competing execution-control requests.
- [ ] Add source filtering without hiding Call Stack frames.
- [ ] Keep instruction-granularity stepping available.
- [ ] Gate Step Out on verified caller state.
- [ ] Add optimized line/range/inline/tail-call tests.
- [ ] Pass real-emulator Step Into, Step Over, and Step Out scenarios.
- [ ] Document source stepping and optimized-code behavior.