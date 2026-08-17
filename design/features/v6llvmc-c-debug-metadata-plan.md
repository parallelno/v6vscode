# v6llvmc C Debug Metadata Implementation Plan

**Status:** Proposed
**Date:** 2026-08-15
**Owner:** v6llvmc maintainers
**Consumer:** v6vscode
**Related roadmap:** `c-debugging-and-call-stack-plan.md`

Checkboxes: `[x]` complete; `[~]` partially implemented; `[ ]` not complete.

## 1. Problem

The final V6C ELF already contains source lines, function DIEs, type DIEs, ranges, static/global addresses, and indexed DWARF v5 sections. It does not yet provide enough metadata for reliable C locals, parameters, lexical scopes, semantic caller frames, inline frames, or Step Out.

Observed missing or incomplete output includes:

- Local and parameter locations across their machine-code lifetimes.
- `.debug_loclists` location transitions and gaps.
- Complete lexical-block and inline-subroutine descriptions.
- `.debug_frame` or equivalent debugger unwind rules.
- A frozen V6C DWARF register-number contract.

The extension must not infer these facts from arbitrary stack words or instruction patterns. The compiler must describe them after final register allocation, spill insertion, frame lowering, and link relocation.

## 2. Scope

This plan covers C compiled by the V6C Clang/LLVM backend and linked into the final ELF companion.

In scope:

- Debugger-relevant V6C ABI documentation.
- DWARF register numbering.
- Formal parameters, locals, lexical ranges, and variable lifetimes.
- C scalar, pointer, array, structure, union, enum, typedef, and qualifier type metadata.
- Inline-subroutine metadata.
- Call-frame information for physical unwinding.
- Final linked-ELF verification at `-O0`, debug-friendly optimization, `-O1`, and `-O2`.

Out of scope:

- Runtime expression execution.
- Debugger UI or DAP implementation.
- Recovering values LLVM has optimized away.
- Exception-runtime unwinding semantics.

## 3. Freeze the V6C ABI Contract

Document and test:

- Stack growth direction and alignment.
- Width and byte order of return addresses.
- CALL/RET return-address semantics.
- Argument registers and stack argument layout by width and C aggregate class.
- Return-value registers.
- Caller-saved and callee-saved registers.
- Prologue and epilogue variants.
- Frame-pointer policy and omission behavior.
- Local stack allocation and dynamic allocation behavior.
- Tail-call behavior.
- Interrupt/trampoline frame layout and unwind boundary policy.

The ABI document is normative for backend tests and CFI validation. v6vscode consumes emitted rules rather than maintaining a second prologue decoder.

## 4. DWARF Register Numbering

Define stable DWARF numbers for every addressable V6C register used by debug values or CFI, including byte registers, register pairs, SP, PC where applicable, and flags only if exposed as locations.

Requirements:

- One versioned table in backend documentation.
- TableGen/backend mapping tests.
- `llvm-dwarfdump` assertions for register and base-register locations.
- No compiler-build-dependent numbering.
- A documented policy for overlapping byte and word registers.

## 5. Local and Parameter Locations

Preserve and lower LLVM debug values after instruction selection, register allocation, spills, and frame-index elimination.

Required output:

- `DW_TAG_formal_parameter` and `DW_TAG_variable`.
- `DW_AT_location` as an expression or location-list reference.
- `DW_AT_frame_base` when `DW_OP_fbreg` is used.
- Register locations for byte and word values.
- Stack/frame-relative locations for spills and allocas.
- Constant or implicit values when LLVM proves them.
- Explicit gaps when a value is not recoverable.
- Piecewise locations only after producer and consumer tests agree on the representation.

Do not extend a variable location beyond the PC range where the machine value remains valid.

## 6. Location Lists and Optimized Lifetimes

Emit `.debug_loclists` for values that move between registers, stack slots, memory, constants, or unavailable states.

Verify:

- Base-address selection and indexed addresses.
- Half-open PC ranges.
- Disjoint lifetimes.
- Register-to-register moves.
- Spill and reload transitions.
- Prologue and epilogue gaps.
- Constant propagation.
- Values removed by optimization.
- Shadowed variables with separate DIE identities.

At optimized levels, absence of an active location is valid and must remain distinguishable from malformed metadata.

## 7. Lexical and Function Ranges

Emit linked final ranges for:

- `DW_TAG_subprogram`.
- `DW_TAG_lexical_block`.
- Variables scoped to blocks or functions.
- Discontinuous machine ranges after optimization.

Subprogram DIEs must include name, declaration coordinates, return type, and calling convention when non-default. Final linked addresses must use the same 16-bit CPU address space as the ROM.

## 8. Inline Metadata

Emit:

- `DW_TAG_inlined_subroutine`.
- `DW_AT_abstract_origin` references.
- Inline ranges.
- Call file, line, and column.
- Abstract formal parameters and local origins.
- Nested inline chains.

Tests must cover C header helpers, nested inline calls, an inline call with optimized-out arguments, and an inline call spanning discontinuous ranges.

## 9. Type Metadata

Ensure final ELF type DIEs accurately describe C types required by the debugger:

- Signed and unsigned integer base types.
- `_Bool` and character types.
- Enumerations and enumerators.
- Pointer types and function pointers.
- Arrays and subranges.
- Structures, unions, and members.
- Typedefs.
- `const`, `volatile`, `restrict`, and `_Atomic` qualifiers when emitted by the frontend.
- Subroutine types.

Member offsets, bit sizes, array counts, and byte sizes must match the V6C data layout.

## 10. Call-Frame Information

Prefer `.debug_frame` for debugger-only physical unwinding. Emit a Common Information Entry and Frame Description Entries covering every unwindable function.

Rules must recover:

- Canonical Frame Address.
- Return-address location.
- Caller SP.
- Saved callee registers.
- Frame pointer when used.

Emit CFI state changes through prologue and epilogue instructions. Cover multiple returns, frame-pointer omission, local stack allocation, spills, and supported tail-call behavior. Mark interrupt or trampoline boundaries honestly when ordinary C unwinding cannot continue.

## 11. Supported DWARF Contract

Publish the exact forms and operations emitted for V6C. Coordinate this table with `c-debug-dwarf-metadata-plan.md`.

Expected location operations include:

- Address and indexed-address operations.
- Register and base-register operations.
- `DW_OP_fbreg`.
- Constants and literals.
- Addition/subtraction and `plus_uconst`.
- Dereference operations.
- `DW_OP_stack_value`.
- `DW_OP_piece` only when split values are enabled.

Avoid introducing a new form or operation without a producer test and a consumer compatibility entry.

## 12. Verification Strategy

Add LLVM IR, MIR, backend, and linked-ELF tests for:

- Register and stack parameters.
- Register locals, stack locals, spills, and reloads.
- Shadowed lexical locals.
- Pointers, arrays, structures, unions, enums, and typedefs.
- Location-list transitions and gaps.
- Leaf and non-leaf C calls.
- Frame pointer enabled and omitted.
- Multiple return sites and tail calls.
- Nested inline calls.
- Final linked addresses matching ROM execution.
- `-O0`, debug-friendly optimization if defined, `-O1`, and `-O2`.

Use `llvm-dwarfdump --verify` where target support permits, plus V6C-specific assertions for 16-bit addresses and register numbering. Validate unwinding against real emulator register and memory snapshots.

## 13. Acceptance Gates

The producer prerequisite is complete only when:

- Final linked ELFs contain accurate locations and CFI, not only object files.
- A three-function C call chain unwinds correctly from real stopped state.
- Each frame exposes at least one tested parameter and local where recoverable.
- Inline metadata reconstructs a nested inline chain.
- Optimized-out and inactive-range values are represented as absent locations.
- v6vscode fixture and real-emulator tests consume the emitted contract without target-specific guessing.

## 14. Implementation Checklist

- [x] Document the debugger-relevant V6C ABI.
- [x] Freeze V6C DWARF register numbering.
- [x] Add backend tests for overlapping byte and word register locations.
- [x] Preserve debug values through custom V6C machine passes.
- [x] Emit formal-parameter and local-variable locations.
- [x] Emit valid frame-base expressions where required.
- [x] Emit `.debug_loclists` with accurate transitions and gaps.
- [x] Emit lexical-block and discontinuous function ranges.
- [x] Emit nested inline-subroutine DIEs and abstract origins.
- [x] Verify C scalar, pointer, array, structure, union, enum, typedef, and qualifier types.
- [x] Emit `.debug_frame` CIE/FDE data.
- [x] Cover leaf/non-leaf, spills, stack arguments, frame-pointer modes, returns, tail calls, and unwind boundaries.
- [x] Verify final linked addresses and relocations against ROM execution.
- [x] Run `-O0`, debug-friendly, `-O1`, and `-O2` metadata tests.
- [x] Publish the supported forms, operations, register map, and known limitations.
- [~] Pass v6vscode parser and real-emulator consumer tests.