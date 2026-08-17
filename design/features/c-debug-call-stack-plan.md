# C Semantic Call Stack Implementation Plan

**Status:** Proposed
**Date:** 2026-08-15
**Owner:** v6vscode maintainers
**Prerequisites:** `v6llvmc-c-debug-metadata-plan.md`, `c-debug-dwarf-metadata-plan.md`
**Related roadmap:** `c-debugging-and-call-stack-plan.md`

Checkboxes: `[x]` complete; `[~]` partially implemented; `[ ]` not complete.

## 1. Problem

The DAP adapter currently returns one synthetic CPU frame. A known function is displayed with its PC, and no verified callers or inline frames are available. Raw words around SP are exposed separately but cannot be treated as return addresses.

The native Call Stack must show semantic C functions such as:

```text
copyToDisplay
bubbleSort
main
```

Source file and line belong in DAP source fields, not in the frame name. Physical callers require valid CFI; inline callers require inline DIEs and ranges.

## 2. Scope

In scope:

- One stopped-generation snapshot.
- Verified physical unwinding from DWARF CFI.
- Inline logical frames.
- Stable DAP frame IDs, pagination, names, source, and PC references.
- Per-frame register state needed by later variable evaluation.
- Honest fallback at unsupported unwind boundaries.

Out of scope:

- Guessing callers by scanning stack memory.
- Local-variable presentation, which is owned by `c-debug-variables-and-expressions-plan.md`.
- Source stepping, except exposing verified caller resume PCs to the stepping service.

## 3. Stopped-Generation State

Create one immutable context per stop:

```ts
interface DebugStopContext {
  generation: number;
  stopSequence?: number;
  reason: StopReason;
  registers: RegisterFile;
  physicalFrames: PhysicalFrame[];
  dapFrames: DapFrameContext[];
  memory: StopMemoryReader;
}
```

Resume, reset, ROM reload, disconnect, or a newer stop invalidates every frame ID and variables reference from the old generation.

Capture top-frame PC, SP, and all DWARF-mapped registers from one paused state. If existing v6emul requests cannot guarantee coherence, add a versioned stopped-snapshot capability before enabling semantic frames.

## 4. Physical Unwinding

Start frame 0 from authoritative registers. For each frame:

1. Find the FDE and CFI row covering the current PC.
2. Compute the Canonical Frame Address.
3. Recover the return PC, caller SP, and recoverable saved registers.
4. Validate memory reads and 16-bit addresses.
5. Reject cycles, unchanged CFA, impossible stack movement, or repeated PCs.
6. Stop at the first unsupported or unverifiable rule.

Limits:

- Maximum 64 physical frames.
- Bounded CFI operations and memory reads per frame.
- No address wrap unless explicitly defined by the CFI operation and V6C ABI.
- No continuation through an interrupt/trampoline boundary without an explicit unwind description.

## 5. Resume and Display PCs

Keep separate addresses when required:

- **Resume PC:** exact return address used to continue execution and implement physical Step Out.
- **Display PC:** source location representing the call site in the caller.

Prefer emitted call-site metadata. A fallback may choose the preceding statement only inside the verified caller subprogram range. Never subtract blindly across function boundaries.

## 6. Inline Logical Frames

For each physical frame, expand the active `DW_TAG_inlined_subroutine` chain.

Requirements:

- Resolve names and declarations through `DW_AT_abstract_origin`.
- Use inline ranges to determine active calls.
- Use call file, line, and column for containing logical frames.
- Support nested inline chains.
- Share physical registers and CFA while retaining a distinct lexical context.
- Do not consume stack memory for inline frames.

Inline frame order is innermost first, followed by the concrete physical function and then physical callers.

## 7. DAP Frame Model

Each DAP frame context records:

- Stopped generation.
- Stable frame ID.
- Physical frame index.
- Optional inline DIE identity.
- Function name.
- Exact instruction PC.
- Source display location.
- CFA, frame base, and recovered registers where available.
- Verified caller resume PC where available.

Honor DAP `startFrame` and `levels`. Return an accurate `totalFrames` for the verified frame set.

## 8. Call Stack Presentation

Known frames use only the semantic function name:

```text
main
```

Do not render:

```text
main 0x0194
```

The PC remains in `instructionPointerReference`. Source file, line, and column remain in the DAP `source`, `line`, and `column` fields.

Fallbacks:

- Known symbol but no DIE: use the symbol name and exact PC.
- Unknown top frame: use `0xNNNN` with no fabricated source.
- Unsupported outer unwind: return all verified frames and stop; do not append guessed frames.
- ASM or line-only C: retain one honest machine frame.

Runtime/helper frames may receive `presentationHint: "subtle"` only under a documented setting. They remain visible by default.

## 9. Adapter Refactoring

Extract frame responsibilities from the monolithic adapter:

```text
debug-session-state.ts   stop generation and invalidation
stack-trace-service.ts   physical unwind and inline expansion
dap-handle-store.ts      frame and scope handles
```

`v6-debug-adapter.ts` remains DAP orchestration. The stack service consumes immutable metadata and a stopped-state register/memory interface.

## 10. Capability and Failure Policy

Semantic caller frames require:

- Parsed subprogram metadata.
- CFI covering the current PC.
- Coherent stopped registers.
- Readable stack memory.

Inline frames additionally require inline DIEs, origins, and ranges.

Failure of one outer frame does not remove verified inner frames. Return a diagnostic through logs or a dedicated optional status surface; do not put noisy errors into every frame name.

## 11. Tests

Unit tests:

- Leaf frame.
- Three physical callers.
- Register recovery and saved-register changes.
- Prologue, body, and epilogue CFI rows.
- Cycles, unchanged CFA, invalid memory, unsupported rules, and depth limit.
- Nested inline chain.
- Stable frame IDs and stale-generation rejection.
- `startFrame`, `levels`, and `totalFrames`.
- Semantic names and machine fallback.

Real Extension Host plus emulator tests:

- Stop in the innermost function of a three-function C chain.
- Assert Call Stack names, source lines, PCs, and order.
- Select each frame and verify its context remains stable.
- Stop in nested inline code under optimization.
- Verify an unsupported unwind boundary truncates honestly.

## 12. Acceptance Gates

- No caller is shown without a verified CFI unwind.
- Known functions display semantic names without embedded PC/file text.
- A three-function real C chain matches real emulator stack state.
- Nested inline calls appear in the expected order.
- ASM and incomplete C metadata retain the one-frame fallback.
- Step Out can consume a verified caller resume PC without recomputing a guessed address.

## 13. Implementation Checklist

- [ ] Add stopped-generation context and invalidation.
- [ ] Add stopped-state register and memory abstraction.
- [ ] Map top-frame PC/SP/registers into a physical frame.
- [ ] Implement bounded physical CFI unwinding.
- [ ] Recover caller registers, CFA, SP, and return PC.
- [ ] Separate resume PC from display PC.
- [ ] Stop honestly at unsupported rules and unwind boundaries.
- [ ] Expand active inline DIEs into logical frames.
- [ ] Assign stable generation-bound DAP frame IDs.
- [ ] Implement `startFrame`, `levels`, and `totalFrames`.
- [ ] Use semantic function names in Call Stack.
- [ ] Preserve instruction pointers and honest unknown-frame fallbacks.
- [ ] Extract stack-trace and handle services from the adapter.
- [ ] Add physical, inline, malformed, and fallback unit tests.
- [ ] Pass a real-emulator three-function Call Stack test.
- [ ] Document Call Stack behavior and metadata prerequisites.