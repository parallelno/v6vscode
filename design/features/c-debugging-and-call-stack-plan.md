# C Debugging Implementation Roadmap

**Status:** Proposed
**Date:** 2026-08-15
**Owners:** v6vscode, v6llvmc, and v6emul maintainers

Checkboxes: `[x]` complete; `[~]` partially implemented; `[ ]` not complete.

## 1. Scope

This roadmap coordinates the missing C debugging work without duplicating detailed requirements in one large document.

Current C support includes final-ELF source breakpoints, stopped-line highlighting, function symbols, registers, flags, raw stack values, conditional breakpoints, hit counts, logpoints, instruction Step Into, and backend-assisted instruction Step Over.

Missing semantic C support includes:

- Local variables and formal parameters.
- Lexical scopes and frame-sensitive name lookup.
- C Watch, hover, and Debug Console expressions.
- Typed integers, enums, pointers, arrays, structures, unions, and C type qualifiers.
- Verified physical caller frames and inline logical frames.
- Informative native Call Stack entries.
- Reliable source Step Into, Step Over, and Step Out.
- DWARF range, location-list, expression, type, inline, and call-frame evaluation.

The feature targets C produced by the V6C Clang/LLD toolchain. Other source languages are outside this roadmap.

## 2. Plan Set

### 2.1 Compiler metadata prerequisite

[`v6llvmc-c-debug-metadata-plan.md`](v6llvmc-c-debug-metadata-plan.md)

Owned by v6llvmc. Defines the V6C ABI/debug contract and the missing producer work for local/parameter locations, lexical and inline ranges, type metadata, and call-frame information.

This is the first hard gate. v6vscode must not fabricate locals or caller frames before the final linked ELF contains sufficient metadata.

### 2.2 DWARF metadata consumer

[`c-debug-dwarf-metadata-plan.md`](c-debug-dwarf-metadata-plan.md)

Owned by v6vscode. Replaces narrow version-specific readers with a bounded DWARF core and indexes for types, scopes, variables, ranges, locations, inline calls, and CFI.

### 2.3 Semantic Call Stack

[`c-debug-call-stack-plan.md`](c-debug-call-stack-plan.md)

Owned primarily by v6vscode, with v6emul register/memory support. Defines stopped-generation state, verified physical unwinding, inline logical frames, native Call Stack presentation, and Step Out prerequisites.

### 2.4 Variables and C expressions

[`c-debug-variables-and-expressions-plan.md`](c-debug-variables-and-expressions-plan.md)

Owned by v6vscode. Defines Parameters, Locals, Statics, Globals, typed expansion, optimized-out values, and a read-only frame-sensitive C expression evaluator.

### 2.5 Source-level stepping

[`c-debug-source-stepping-plan.md`](c-debug-source-stepping-plan.md)

Owned by v6vscode, with v6emul execution control. Defines logical source locations, source Step Into/Over/Out, inline depth behavior, interruption, temporary breakpoints, and optimized-code policy.

## 3. Delivery Order

1. Complete and verify the v6llvmc metadata prerequisite.
2. Implement the version-neutral v6vscode DWARF consumer.
3. Implement semantic Call Stack and stopped-generation frame state.
4. Implement frame scopes, typed variables, and C expressions.
5. Implement semantic source stepping.
6. Run the optimization-level matrix and publish compatibility documentation.

Each downstream phase may begin with synthetic fixtures, but it is complete only after the corresponding producer metadata exists in a final linked V6C ELF and passes a real Extension Host plus real-emulator scenario.

## 4. Shared Invariants

- Never present arbitrary stack words as verified call frames.
- Never show a stale variable location outside its active PC range.
- Never reconstruct a value that the compiler reports as optimized out.
- Unsupported optional metadata disables only the dependent value or feature.
- Existing ASM and line-table-only C debugging must continue to work.
- Frame IDs and variable handles are valid only for one stopped generation.
- All parsing, expression evaluation, memory reads, and stepping loops are bounded.
- Optimized behavior follows emitted DWARF rather than source-level assumptions.

## 5. Shared Acceptance Matrix

Test dedicated C programs at `-O0`, a debug-friendly optimization level if V6C defines one, `-O1`, and `-O2`.

Required end-to-end scenarios:

- Three physical C calls shown in Call Stack.
- Nested inline calls shown as logical frames.
- Parameters and locals for each selected frame.
- Pointer, array, structure, union, and enum formatting.
- Watch expressions against current and caller frames.
- Source Step Into, Step Over, and Step Out.
- Honest optimized-out and inactive-range values.
- Breakpoint relocation when a C line has no emitted instruction.
- Machine-level fallback for ASM and incomplete C metadata.

## 6. Implementation Checklist

- [x] Approve the V6C ABI and DWARF producer contract.
- [x] Complete `89-.
- [x] Complete `c-debug-dwarf-metadata-plan.md`.
- [ ] Complete `c-debug-call-stack-plan.md`.
- [ ] Complete `c-debug-variables-and-expressions-plan.md`.
- [ ] Complete `c-debug-source-stepping-plan.md`.
- [ ] Preserve existing ASM and baseline C debugging through every phase.
- [ ] Run compiler, parser, adapter, Extension Host, real-emulator, and sanitizer verification.
- [ ] Publish the supported metadata and optimization compatibility matrix.
- [ ] Update user, developer, architecture, and project-template documentation.