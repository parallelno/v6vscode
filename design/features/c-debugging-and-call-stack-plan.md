# C Debugging and Semantic Call Stack Implementation Plan

**Status:** Proposed
**Date:** 2026-08-15
**Owners:** v6vscode and v6llvmc maintainers
**Related work:** `debug-adapter-and-debug-views-plan.md`, `conditional-breakpoints-plan.md`, `v6emul-stop-record-design.md`

Checkboxes: `[x]` complete; `[~]` partially implemented; `[ ]` not complete.

## 1. Problem

### 1.1 Current behavior

C source breakpoints and stopped-line highlighting work from final ELF line tables. The debugger also exposes registers, flags, a raw stack sample, instruction Step Into, backend-assisted Step Over, symbols, conditional breakpoints, hit counts, and logpoints.

The native Call Stack panel contains one synthetic CPU frame. Its name is currently a symbol plus PC, or only a PC, for example:

```text
main 0x0194
```

or:

```text
0x0194 main.c
```

This frame does not represent callers, inline calls, lexical scopes, parameters, or local variables. The adapter cannot implement reliable Step Out because it cannot recover a verified caller return address.

The current metadata reader handles ELF32 symbols, DWARF v4/v5 line tables, compilation directories, and a narrow constant-declaration subset. It does not build a general Debugging Information Entry (DIE) graph or evaluate variable locations, ranges, types, or call-frame instructions.

The current V6C ELF demonstrates the metadata boundary:

- Present: `.debug_info`, `.debug_abbrev`, `.debug_line`, `.debug_rnglists`, `.debug_str`, `.debug_str_offsets`, `.debug_addr`, and `.debug_line_str`.
- Partially present: subprogram DIEs, ranges, static/global addresses, and type DIEs.
- Not yet sufficient: local/parameter locations across their lifetimes, lexical-block locations, `.debug_loclists`, and `.debug_frame` or `.eh_frame` unwind rules.

Therefore the adapter must not infer semantic frames from arbitrary stack words or fabricate unavailable variable values.

### 1.2 Desired behavior

For a C build with complete debug metadata, the VS Code debugger must provide:

1. A semantic Call Stack containing the current function, verified physical callers, and inline logical frames.
2. Informative frame names such as `main`, `bubbleSort`, or `copyToDisplay`, with source file and line supplied through DAP source fields rather than embedded in the name.
3. Parameters, Locals, Statics/Globals, Registers, Flags, and Raw Stack scopes as applicable to each selected frame.
4. Typed values for integers, enums, pointers, arrays, structures, unions, and qualified/typedef types.
5. C-aware Watch, hover, and Debug Console evaluation against the selected frame.
6. Reliable source-level Step Into, Step Over, and Step Out when line, inline, location, and unwind metadata permit them.
7. Honest optimized-code behavior: moved lines, merged statements, inlined headers, unavailable variables, and discontinuous ranges must be represented rather than hidden.
8. Capability gating and actionable diagnostics when the ELF or emulator lacks a required contract.

For ASM or incomplete C metadata, the debugger must retain the current machine-level behavior without presenting guessed semantic data.

### 1.3 Root causes

The missing functionality spans three ownership boundaries:

- **v6llvmc:** must emit valid V6C variable locations, lexical ranges, inline DIEs, and call-frame information after register allocation and frame lowering.
- **v6vscode metadata layer:** must parse the required DWARF v5 subset into immutable type, scope, variable, inline, location, and unwind indexes.
- **v6vscode DAP layer:** must model stopped generations, frame identities, scopes, typed variables, C expressions, semantic stepping, and Call Stack presentation.

v6emul already provides registers and memory access while stopped. It may need a bounded bulk-read or coherent stopped-snapshot capability if existing requests cannot evaluate frames and aggregate variables without excessive IPC traffic or inconsistent state.

## 2. Scope and Non-Goals

### 2.1 In scope

- V6C ELF32, little-endian, 16-bit CPU addresses.
- DWARF v5 emitted by the current V6C Clang/LLD toolchain, plus existing DWARF v4 line compatibility.
- Physical stack unwinding from DWARF call-frame information.
- Inline logical frames from `DW_TAG_inlined_subroutine`.
- Local variables, formal parameters, lexical scopes, globals/statics, and typed value expansion.
- C expression evaluation without executing target code.
- Source-level stepping based on emitted statement rows and semantic frame depth.
- Native VS Code Call Stack, Variables, Watch, hover, and Debug Console surfaces.
- Explicit optimized-code semantics and unavailable-value reporting.
- Unit, compiler, fixture, Extension Host, and real-emulator tests.

### 2.2 Out of scope for the first release

- Calling arbitrary target functions from expressions.
- Assignment expressions or mutation through Watch/Evaluate.
- C++ classes, templates, exceptions, RTTI, or overloaded expressions.
- Reverse semantic stepping.
- Heuristic stack scanning presented as verified callers.
- Perfect reconstruction of optimized-away variables.
- Supporting every DWARF opcode or form before the V6C producer emits it.

Unsupported metadata must produce a bounded diagnostic and a reduced capability, not a fabricated result or a failed debug session.

## 3. Required Producer and Runtime Contracts

### 3.1 Freeze the V6C ABI contract

Document and test the debugger-relevant ABI in v6llvmc:

- Stack growth direction and alignment.
- Width and byte order of return addresses.
- CALL/RET return-address semantics.
- Argument registers and stack argument layout by width and aggregate class.
- Return-value registers.
- Caller-saved and callee-saved registers.
- Prologue/epilogue variants.
- Frame-pointer policy and frame-pointer omission behavior.
- Dynamic stack allocation behavior.
- Interrupt/trampoline frame layout and whether such frames are unwindable.
- Tail-call behavior.

The ABI document is normative for compiler tests and for validating emitted CFI. The extension consumes DWARF rules and must not duplicate prologue pattern matching as its primary unwinder.

### 3.2 Emit local and parameter locations in v6llvmc

After instruction selection, register allocation, spill insertion, and frame-index elimination, preserve and lower debug values into valid DWARF locations.

Required producer coverage:

- `DW_TAG_formal_parameter` and `DW_TAG_variable`.
- `DW_AT_location` as an expression or location-list reference.
- `DW_AT_frame_base` where `DW_OP_fbreg` is emitted.
- Register locations for byte and word registers.
- Stack/frame-relative locations for spills and allocas.
- Constant and implicit values where LLVM proves a value.
- Piecewise locations for split values only after the consumer supports them.
- Accurate variable lifetimes across disjoint optimized ranges.
- Explicit absence of a location when a value is optimized away.

Emit `.debug_loclists` for location changes. Do not extend a location beyond the range where the machine value is valid.

### 3.3 Emit lexical, function, and inline ranges

Required DIEs and attributes:

- `DW_TAG_subprogram` with linked final ranges, name, linkage name where relevant, declaration coordinates, return type, and calling convention if non-default.
- `DW_TAG_lexical_block` with ranges.
- `DW_TAG_inlined_subroutine` with `DW_AT_abstract_origin`, ranges, and call file/line/column.
- Abstract subprogram and parameter origins for inlined code.
- `.debug_rnglists` entries using well-defined base-address semantics.

Linker tests must prove that final ranges and indexed addresses are relocated to the same CPU address space as the ROM.

### 3.4 Emit call-frame information

Prefer `.debug_frame` for debugger-only unwind information. `.eh_frame` may also be supported, but exception-runtime semantics are not required.

The producer must emit Frame Description Entries that cover every unwindable function and describe changes through prologue and epilogue instructions. Required rules include:

- Canonical Frame Address definition.
- Return-address location.
- Saved callee-register locations.
- Stack-pointer recovery.
- Frame-pointer recovery when used.
- Distinct rows for shrink-wrapped or multiple epilogue paths if the backend can produce them.

At minimum, validate LLVM emission for:

- Leaf function.
- Non-leaf function.
- Register-only arguments.
- Stack arguments.
- Local stack allocation.
- Register spills.
- Frame pointer enabled and omitted.
- Multiple return sites.
- Tail call.
- Optimized and unoptimized builds.

### 3.5 Define the supported DWARF subset

Create a versioned compatibility table shared by v6llvmc tests and v6vscode documentation.

Initial forms should include the forms already emitted by V6C plus those required for variables and frames:

- Strings: `DW_FORM_string`, `strp`, `line_strp`, `strx`, and fixed-width `strx` variants.
- Addresses: `addr`, `addrx`, and fixed-width `addrx` variants.
- References: CU-relative and section-relative references used by the producer.
- Constants: fixed-width data, signed/unsigned LEB128, implicit constants, and flag forms.
- Sections/ranges: `sec_offset`, `rnglistx`, and `loclistx`.
- Expressions: `exprloc`.

Initial location operations should include:

- `DW_OP_addr`, `addrx`.
- `DW_OP_reg0..reg31`, `regx`.
- `DW_OP_breg0..breg31`, `bregx`.
- `DW_OP_fbreg`.
- Literal and constant operations.
- `DW_OP_plus`, `plus_uconst`, `minus`.
- `DW_OP_deref`, `deref_size`.
- `DW_OP_stack_value`.
- `DW_OP_piece` only when split-value producer tests exist.

Unsupported operations make only that value unavailable. They must not invalidate source lines, symbols, other variables, or the debug session.

### 3.6 Runtime state and memory contract

A semantic stop must evaluate all frames from one coherent paused generation.

Use existing v6emul requests if they satisfy these requirements:

- `GET_REGS` returns all DWARF-mapped registers and PC/SP from the same stopped state.
- `GET_MEM` performs bounded arbitrary RAM reads needed by location and CFI evaluation.
- Requests are serialized while execution is stopped.
- Reset, reload, resume, or a newer stop invalidates all frame and variable handles.

If repeated reads are too expensive or can cross state transitions, add a versioned debugger snapshot capability containing a stop sequence, registers, and bounded memory reads tied to that sequence. Never reuse variable or frame values after the stop sequence changes.

## 4. v6vscode Metadata Architecture

### 4.1 Replace narrow readers with a version-neutral DWARF core

Keep line-table behavior stable, but introduce focused modules under `src/debug/metadata/`:

```text
dwarf-reader.ts            unit headers, DIE traversal, forms, references
dwarf-sections.ts          .debug_* section access and bounds checks
dwarf-strings.ts           str/line_str/str_offsets resolution
dwarf-addresses.ts         addr/addrx resolution
dwarf-ranges.ts            v4 ranges and v5 rnglists
dwarf-locations.ts         exprloc and loclists
dwarf-types.ts             immutable type graph
dwarf-scopes.ts            CU/subprogram/lexical/inline graph
dwarf-cfi.ts               CIE/FDE parsing and unwind rows
dwarf-expression.ts        bounded DWARF stack-machine evaluator
debug-metadata-index.ts    query facade for the adapter
```

Do not continue growing version-specific files into one parser. Preserve the existing line and symbol APIs through adapters while migrating tests.

### 4.2 Build an immutable DIE graph

Represent DIE identity by compilation unit and section offset. Resolve references lazily with cycle detection.

Core entities:

```ts
interface DebugCompilationUnit {
  id: string;
  version: 4 | 5;
  addressSize: number;
  compDir?: string;
  root: DieId;
}

interface DebugSubprogram {
  id: DieId;
  name: string;
  linkageName?: string;
  ranges: AddressRange[];
  frameBase?: LocationDescription;
  returnType?: TypeId;
  parameters: VariableId[];
  lexicalRoot: ScopeId;
}

interface DebugVariable {
  id: VariableId;
  name: string;
  kind: 'parameter' | 'local' | 'static' | 'global';
  type?: TypeId;
  declaration?: SourceLocation;
  location?: LocationDescription;
  constValue?: bigint;
  abstractOrigin?: VariableId;
}
```

Validate all offsets, lengths, references, list indices, and address arithmetic. Parsing malformed optional metadata should degrade the affected compilation unit with a diagnostic while preserving independently valid line tables where possible.

### 4.3 Build a type graph

Support these tags in the first typed-variable release:

- Base types and encodings.
- Pointer types.
- Arrays and subranges.
- Structures and unions.
- Members with byte/bit offsets.
- Enumerations and enumerators.
- Typedef, const, volatile, restrict, and atomic wrappers.
- Subroutine types for readable function pointers.

Use stable `TypeId` references and cache resolved display names and byte sizes. Detect recursive types without recursively expanding forever.

### 4.4 Build scope, inline, and address indexes

Indexes must answer:

- Physical subprogram containing a PC.
- Active lexical-scope chain at a PC.
- Active inline chain at a PC, ordered outermost to innermost.
- Variables visible in a selected physical or inline frame.
- Location expression active at a PC.
- Source statement ranges and next/previous distinct logical locations.
- FDE and CFI row covering a PC.

Ranges are half-open `[start, end)`. Empty, overlapping, and discontinuous ranges must be tested explicitly.

## 5. Frame and Unwind Model

### 5.1 Stopped-generation context

Create a `DebugStopContext` for each authoritative stop:

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

Every DAP frame ID and `variablesReference` encodes or maps to this generation. Requests using stale handles return a clear invalid-frame/invalid-variable response.

### 5.2 Physical unwinding

Start frame 0 from authoritative PC, SP, and registers. For each frame:

1. Find the FDE covering the current PC.
2. Evaluate CFI instructions up to that PC.
3. Compute the Canonical Frame Address.
4. Recover the return PC, caller SP/CFA, and recoverable callee-saved registers.
5. Reject cycles, unchanged CFA, invalid memory, out-of-range addresses, and excessive depth.
6. Stop honestly at the first unsupported or unverifiable rule.

Use limits such as 64 physical frames, bounded CFI operations per row, and bounded memory reads.

Keep two caller addresses where needed:

- **Resume PC:** exact return address used for continued execution and Step Out.
- **Display PC:** call-site source location. Prefer DWARF call-site metadata; otherwise choose the preceding statement only within the verified caller subprogram range. Never subtract blindly across function boundaries.

### 5.3 Inline logical frames

Expand each physical frame into zero or more inline frames plus its concrete subprogram frame.

For the innermost active physical PC:

- Follow active `DW_TAG_inlined_subroutine` ranges.
- Resolve names and parameters through `DW_AT_abstract_origin`.
- Use call file/line/column for the caller-side inline frame location.
- Keep the concrete physical frame available for registers and unwind ownership.

Inline frames do not consume stack memory and cannot be unwound as physical callers. Their frame context references the same physical register/CFA state with a different lexical/inline scope.

### 5.4 Call Stack presentation

Return DAP frames ordered innermost first. Frame names should be concise:

```text
copyToDisplay
bubbleSort
main
```

Do not include the PC or file name in a known function's `name`; VS Code already renders source and line. Include:

- `instructionPointerReference` for every physical and inline frame.
- `source`, `line`, and `column` when verified.
- `moduleId` or presentation hint only if they add accurate information.
- `presentationHint: "subtle"` for runtime/helper frames only under a documented user setting; do not hide them by default.

Fallbacks:

- Known symbol but no DIE: `symbolName` with the exact PC.
- Unknown top frame: `0xNNNN` and no fabricated source.
- Unwind stops after N frames: return the N verified frames; do not append guessed stack words.

Honor DAP `startFrame` and `levels` and return the known `totalFrames`.

## 6. Variables, Types, and Scopes

### 6.1 DAP scope layout

For a selected semantic C frame, return scopes in this order:

1. **Parameters** when formal parameters are available.
2. **Locals** for active lexical blocks, innermost declarations shadowing outer names.
3. **Statics** for function/file static objects visible from the compilation unit.
4. **Globals** as an expensive scope, optionally paged or filtered.
5. **Registers**.
6. **Flags**.
7. **Raw Stack**.

For ASM or metadata-limited frames, retain Registers, Flags, and Raw Stack only.

Use unique scope handles per frame and stopped generation. Do not share one global Locals handle among frames.

### 6.2 DWARF location evaluation

Evaluate a variable against:

- Selected frame PC.
- Frame registers recovered by CFI.
- CFA and frame base.
- Stopped-generation memory reader.
- V6C 16-bit address wrapping rules.

Return one of:

```ts
type EvaluatedLocation =
  | { kind: 'memory'; address: number; byteSize?: number }
  | { kind: 'register'; register: DwarfRegister }
  | { kind: 'value'; bytes: Uint8Array }
  | { kind: 'pieces'; pieces: LocationPiece[] }
  | { kind: 'unavailable'; reason: string };
```

Distinguish these user-visible states:

- `<optimized out>`: no active location because the compiler removed the value.
- `<not available at this location>`: location list has no entry for the current PC.
- `<unsupported location: DW_OP_...>`: producer emitted an unsupported operation.
- `<memory unavailable>`: target read failed.

A bad variable must not suppress sibling variables.

### 6.3 Typed value formatting

Use target endianness and declared byte size. Required formatting:

- Signed and unsigned integers with decimal value and optional hex display.
- `_Bool` as `true`/`false`.
- Characters with escaped printable representation.
- Enums as `Name (numeric)` when matched.
- Pointers as `0xNNNN`, with expandable pointee when safe.
- Null pointers as `NULL`.
- Arrays with indexed children and DAP paging (`start`, `count`).
- Structures/unions with member children.
- Typedef names preserved in `type` while formatting through the underlying type.
- Function pointers with resolved symbol when available.

Enforce maximum expansion depth, maximum children per request, bounded string reads, cycle detection, and invalid-pointer diagnostics.

Use `memoryReference` for addressable objects and pointers so VS Code memory actions can integrate later.

### 6.4 Shadowing and lexical visibility

At a selected PC:

- Include only scopes whose ranges contain the PC.
- Order lexical blocks inner to outer.
- Preserve same-name variables internally by DIE identity.
- Present the innermost variable under its source name.
- Optionally present shadowed variables under an expandable `Outer scopes` group; never silently merge their values.
- Inline parameters and locals come from the selected inline context, not automatically from the containing concrete function.

## 7. C Expression Evaluation

### 7.1 Supported first-release grammar

Implement a pure parser and evaluator; never use JavaScript evaluation and never execute target code.

Support:

- Identifiers resolved by selected frame and lexical scope.
- Integer, character, and enum constants.
- Parentheses.
- Unary `+`, `-`, `~`, `!`, dereference `*`, and address-of `&`.
- Binary arithmetic, shifts, bitwise operators, comparisons, and logical operators.
- Array indexing.
- Structure member `.` and pointer member `->`.
- Explicit casts among supported scalar and pointer types after type-name parsing is available.
- Existing register and global symbol expressions as a compatibility fallback.

Defer function calls, assignments, increment/decrement, comma, `sizeof` on expressions with incomplete types, and floating point.

### 7.2 Frame-sensitive resolution

Honor DAP `frameId` for Watch, hover, and Debug Console contexts. Resolution order:

1. Active inline/lexical local.
2. Formal parameter.
3. Function/file static.
4. Global object or enum constant.
5. Register aliases when explicitly supported.

Return expandable results through `variablesReference`, not flattened text. Set `type`, `memoryReference`, `namedVariables`, and `indexedVariables` where known.

Advertise `supportsEvaluateForHovers` only after hover evaluation uses the same frame-safe engine and has bounded latency.

### 7.3 Errors and safety

Use precise errors such as:

- `Unknown identifier 'index' in frame bubbleSort`.
- `Cannot dereference optimized-out variable 'node'`.
- `Pointer 0xFFFF is outside readable memory`.
- `Expression requires unsupported floating-point type`.

Expression evaluation is read-only in this plan. Keep `supportsSetVariable` false until a separate mutation design defines writable locations, const/volatile behavior, partial-register writes, aggregate writes, and rollback/error semantics.

## 8. Reliable Source-Level Stepping

### 8.1 Logical source location

Define a logical location as:

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

A source step completes when execution reaches a different logical location according to the operation's depth policy, not merely after one instruction.

### 8.2 Step Into

Source Step Into must:

1. Capture the starting logical location and frame depth.
2. Execute with temporary breakpoints or bounded instruction stepping.
3. Stop at the first distinct statement in the same frame, a newly entered physical callee, or a newly entered inline frame.
4. Skip rows marked non-statement.
5. Respect user choice for stepping into runtime/library sources through a setting or step filter.
6. Stop on user breakpoint, watchpoint, exception, script break, pause, or halt before applying step completion logic.

Keep instruction stepping available through an explicit instruction granularity request when DAP supplies it.

### 8.3 Step Over

Source Step Over must remain within the starting semantic frame depth:

- Continue to the next distinct statement in the same inline/physical frame.
- If a physical call is executed, use verified unwind/return information to stop after return.
- If code enters a deeper inline frame, treat it according to inline stepping policy and DAP granularity.
- If the current statement has multiple machine ranges, cover all ranges before advancing.
- Never overwrite a user breakpoint at a temporary address.

Backend `GET_STEP_OVER_ADDR` remains the instruction-level fallback, not the semantic C implementation.

### 8.4 Step Out

Advertise `supportsStepOut` only when the selected frame has a verified caller resume PC.

- Inline Step Out exits to the containing inline or concrete frame without changing physical stack depth.
- Physical Step Out uses the unwind result's resume PC and a temporary breakpoint.
- Tail-called frames with no return edge report an unsupported operation or continue to the next verified outer frame according to documented policy.
- The outermost frame returns a clear `No verified caller frame` error.

### 8.5 Budgets and interruption

Every semantic step needs:

- Instruction and wall-clock budgets.
- Cancellation on pause, disconnect, restart, or a newer DAP request.
- Priority for user breakpoints and exceptions.
- Cleanup of temporary breakpoints on every path.
- A diagnostic when no new source statement is reachable before halt or budget exhaustion.

Do not loop indefinitely through code with no line rows.

## 9. Optimized C Semantics

### 9.1 Breakpoints and lines

The debugger follows emitted DWARF and must report verified relocation through the DAP breakpoint response.

- A line with no instruction moves to the next emitted statement in the same file.
- Several requested lines may resolve to one address and therefore one backend breakpoint.
- Several addresses may map to one line; breakpoint policy must install all required ranges only when needed for correctness and reconcile them as one logical DAP breakpoint.
- Discontinuous function and statement ranges must not be collapsed across unrelated code.

The UI and documentation must explain relocated verified lines rather than implying every C line is executable.

### 9.2 Optimized variables

Optimized values may:

- Move between registers and memory.
- Exist only for part of a scope.
- Be represented as constants.
- Be split into pieces.
- Be removed entirely.

Display the value active at the selected PC. Never use a stale location from an earlier range. Show `<optimized out>` when the producer provides no recoverable value.

### 9.3 Inlining

When the PC belongs to inlined header/library code:

- Show the innermost inline frame and its source.
- Show containing inline and concrete callers below it.
- Step behavior follows the inline chain rather than pretending execution remains in `main.c`.
- A setting may skip designated runtime sources during stepping, but Call Stack data remains truthful.

### 9.4 Tail calls and merged code

Tail calls can remove a physical caller frame. Identical-code folding or merged ranges can make one address correspond to multiple abstract origins. The debugger must use producer metadata when unambiguous and otherwise present a bounded ambiguity diagnostic instead of selecting an arbitrary frame.

### 9.5 Optimization-level acceptance matrix

Maintain fixtures for `-O0`, `-Og` if supported, `-O1`, and `-O2`.

- `-O0`: strongest line, variable, and frame expectations.
- `-Og`: preferred interactive-debug profile if V6C defines it.
- `-O1`/`-O2`: verify honest relocation, inline frames, location-list transitions, and optimized-out values; do not require source behavior the compiler does not encode.

Document the recommended project debug flags separately from release flags.

## 10. DAP Adapter Refactoring and Capabilities

### 10.1 Decompose the adapter

Before adding semantic state, extract responsibilities from `v6-debug-adapter.ts`:

```text
debug-session-state.ts       stopped generations and handle invalidation
stack-trace-service.ts       unwind and inline expansion
scope-service.ts             frame scope construction
variable-service.ts          location evaluation and DAP variables
c-expression-service.ts      parser, binding, and evaluation
source-step-service.ts       semantic step state machine
dap-handle-store.ts          frame/scope/value references
```

The adapter remains orchestration and DAP translation. Metadata parsers remain independent of VS Code APIs and emulator transport.

### 10.2 Capability gating

Compute capabilities from both parsed artifact features and emulator server features.

Baseline capabilities remain available with line tables only. Enable features as follows:

| Feature | Required metadata/runtime |
|---|---|
| Function frame name | subprogram DIE or unambiguous function symbol |
| Parameters/Locals | scopes, types, active locations, stopped registers/memory |
| Typed expansion | type graph and memory reader |
| Caller frames | CFI covering the current frame and readable stack |
| Inline frames | inline DIEs, origins, and ranges |
| Step Out | verified caller resume PC |
| Source Step Into/Over | statement index, stop records, temporary breakpoints, semantic frame model |
| Hover evaluation | frame-sensitive expression engine |

DAP initialize capabilities are session-wide. Features that vary per frame must return precise per-request results. Do not advertise a capability merely because one compilation unit supports it if the implementation cannot degrade correctly in another unit.

### 10.3 Call Stack fallback policy

The fallback single CPU frame remains supported for ASM, malformed metadata, interrupt contexts without unwind rules, and the first unsupported unwind row. Improve its name immediately when a function symbol is known:

```text
main
```

rather than:

```text
main 0x0194
```

The PC remains available through `instructionPointerReference` and register scopes.

## 11. Testing and Verification

### 11.1 v6llvmc producer tests

Add LLVM MIR/lit and linked-ELF tests for:

- Parameter locations in registers and on stack.
- Locals before/after spills and register moves.
- Shadowed lexical variables.
- Location-list gaps and transitions.
- Struct, union, enum, pointer, array, typedef, and recursive types.
- Inline origins, call sites, and nested inline ranges.
- CFI rows through prologue/body/epilogue.
- Leaf/non-leaf, frame-pointer/no-frame-pointer, multiple-return, tail-call, and interrupt functions.
- Final linked addresses matching ROM bytes.
- `-O0`, debug-friendly optimization, `-O1`, and `-O2`.

Use `llvm-dwarfdump --verify` where target support permits, plus target-specific assertions for 16-bit addresses and registers.

### 11.2 v6vscode parser tests

Use checked-in minimal fixtures or deterministic fixture-generation scripts. Cover:

- Every supported form, tag, location opcode, range-list entry, and CFI opcode.
- Truncation, overflow, invalid references, cyclic types, malformed lists, and unsupported opcodes.
- 16-bit wrapping and little-endian reads.
- Scope containment and shadowing.
- Inline-chain ordering.
- CFI unwind success and each stop condition.
- Values unavailable without invalidating siblings.

Do not make ordinary unit tests silently depend on mutable files under `temp/`.

### 11.3 Adapter unit tests

Cover:

- Stable frame IDs within one stop and invalidation on resume/new stop.
- `startFrame`/`levels` pagination.
- Frame names and source presentation.
- Physical and inline frame ordering.
- Parameters/Locals/Statics/Globals scope order.
- Variable paging, recursion limits, pointer failures, and optimized-out values.
- Evaluate resolution in selected caller and inline frames.
- Step Into/Over/Out state transitions, interruption, budget exhaustion, and temporary-breakpoint cleanup.
- Capability degradation for partial metadata.

### 11.4 Extension Host and real-emulator tests

Extend the real C breakpoint integration harness to build small dedicated programs and verify:

1. A three-function call chain appears in Call Stack with correct names and source lines.
2. Selecting each frame shows its parameters and locals.
3. Watch expressions evaluate against the selected frame.
4. Pointer, array, and structure expansion reads correct target memory.
5. Step Into enters a callee source line.
6. Step Over remains in the caller.
7. Step Out stops at the verified caller continuation.
8. Nested inline calls appear as logical frames under optimization.
9. An optimized-out variable is reported honestly.
10. ASM and C-with-line-only artifacts retain the current machine-level fallback.

Record the emulator version, compiler revision, ELF fixture hash, stop PC, frame list, and key variable values in test diagnostics.

### 11.5 Acceptance gates

A phase is complete only when:

- Producer metadata exists and is verified in the final linked ELF.
- The parser rejects malformed data safely.
- The DAP feature works through a real Extension Host and real emulator.
- Optimized behavior matches emitted metadata rather than source assumptions.
- Missing metadata degrades only the dependent feature.
- User and developer documentation state supported optimization levels and limitations.

## 12. Delivery Sequence

### Phase A - Metadata and ABI readiness

1. Freeze ABI and DWARF register numbering.
2. Add producer tests for variable locations and CFI.
3. Emit local/parameter locations, lexical/inline ranges, and `.debug_frame`.
4. Add final linked fixture verification.

No C locals or semantic caller capability is exposed before this gate passes.

### Phase B - Version-neutral metadata core

1. Introduce DIE/form/string/address/range parsers.
2. Build type, scope, variable, inline, and CFI indexes.
3. Add bounded DWARF expression and CFI evaluators.
4. Preserve current line-table and symbol behavior.

### Phase C - Semantic Call Stack

1. Add stopped-generation snapshots and frame handles.
2. Unwind verified physical callers.
3. Expand inline logical frames.
4. Replace PC-heavy frame names with semantic function names.
5. Add Call Stack pagination and fallback diagnostics.

This phase directly addresses the current `0x0194 main.c` presentation problem.

### Phase D - Variables and types

1. Add Parameters and Locals scopes.
2. Add location-list evaluation.
3. Add typed scalar formatting.
4. Add pointer, array, structure, union, and enum expansion.
5. Add Statics and paged Globals.

### Phase E - C expressions

1. Add lexer/parser/type checking.
2. Bind identifiers to selected lexical frame.
3. Add dereference, indexing, and member access.
4. Enable Watch and Debug Console contexts.
5. Enable hover capability after latency and safety tests pass.

### Phase F - Semantic stepping

1. Add logical-location and frame-depth tracking.
2. Implement source Step Into.
3. Implement source Step Over.
4. Implement inline and physical Step Out.
5. Add filters, budgets, cancellation, and temporary-breakpoint cleanup.

### Phase G - Optimization hardening and release

1. Run the optimization-level matrix.
2. Document moved lines, inline headers, merged statements, and optimized-out variables.
3. Add capability/metadata diagnostics.
4. Run full unit, integration, regression, compiler, real-emulator, and sanitizer suites.

## 13. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| V6C loses debug values during custom register allocation or spill passes | Add MIR tests around each custom pass and verify final location lists after link. |
| CFI disagrees with real prologues | Compare unwound frames against emulator register/memory snapshots for every prologue variant. |
| Unsupported DWARF forms break all metadata | Isolate errors per attribute/value/CU and retain independently valid line tables. |
| Optimized code creates misleading lines or values | Follow exact ranges and location lists; show relocated lines and `<optimized out>`. |
| Arbitrary stack words are mistaken for callers | Accept only CFI-verified physical frames; keep raw stack separate. |
| Inline and physical frame identities collide | Use stopped-generation frame contexts with explicit physical and inline identities. |
| Variable expansion causes excessive IPC | Cache bounded reads per stop, page children, and add snapshot/bulk-read capability if measured. |
| Recursive/corrupt types exhaust memory | Use type IDs, cycle detection, depth/count limits, and section bounds checks. |
| Semantic stepping runs indefinitely | Enforce instruction/time budgets, cancellation, and stop-reason precedence. |
| Tail calls remove expected callers | Present only metadata-supported frames and document tail-call behavior. |
| Interrupt frames violate C ABI unwind rules | Require explicit producer/backend unwind descriptions or terminate semantic unwinding at the boundary. |

## 14. Documentation Deliverables

Update:

- `docs/debugging.md`: C scopes, Watch grammar, Call Stack, stepping, optimized behavior, and unavailable values.
- `docs/development.md`: fixture generation, producer compatibility matrix, and real-emulator test commands.
- `docs/architecture.md`: metadata graph, stopped-generation state, unwind engine, and service ownership.
- Project templates: recommended debug optimization flags and final ELF retention.
- v6llvmc ABI/debugging documentation: register numbering, variable-location support, CFI policy, and known optimization limitations.

## 15. Implementation Checklist

### ABI and producer metadata

- [ ] Document V6C stack, return-address, argument, return-value, saved-register, frame-pointer, tail-call, and interrupt-frame ABI rules.
- [ ] Freeze and test V6C DWARF register numbering.
- [ ] Preserve LLVM debug values through V6C instruction selection, register allocation, spilling, and frame-index elimination.
- [ ] Emit formal-parameter and local-variable locations for register, stack, constant, and frame-relative values.
- [ ] Emit `.debug_loclists` with accurate disjoint lifetime ranges.
- [ ] Emit lexical-block ranges.
- [ ] Emit inline-subroutine DIEs, abstract origins, and call-site coordinates.
- [ ] Emit `.debug_frame` CIE/FDE data for all supported prologue and epilogue variants.
- [ ] Add v6llvmc tests for leaf/non-leaf, spills, stack arguments, frame pointer, multiple returns, tail calls, inline calls, and optimization levels.
- [ ] Verify final linked ELF addresses, locations, ranges, and CFI against ROM execution.

### DWARF metadata core

- [ ] Introduce version-neutral DWARF section, unit, DIE, form, reference, string, and address readers.
- [ ] Parse v4/v5 ranges and v5 range lists.
- [ ] Parse expression locations and v5 location lists.
- [ ] Build the immutable type graph with recursion protection.
- [ ] Build subprogram, lexical-scope, variable, and inline indexes.
- [ ] Parse CIE/FDE records and build PC-indexed CFI rows.
- [ ] Implement bounded DWARF expression evaluation for the agreed V6C opcode subset.
- [ ] Implement bounded CFI evaluation for the agreed V6C rule subset.
- [ ] Preserve current line-table, symbol, source-breakpoint, and ASM behavior during migration.
- [ ] Isolate unsupported/malformed optional metadata without losing valid source mappings.

### Semantic frames and Call Stack

- [ ] Add stopped-generation state and invalidate frame/value handles on resume, reset, reload, disconnect, or a newer stop.
- [ ] Map authoritative top-frame PC/SP/registers into a physical frame.
- [ ] Unwind verified caller CFA, SP, registers, return PC, and display location.
- [ ] Enforce frame-count, operation, memory-read, cycle, and invalid-address limits.
- [ ] Expand nested inline DIEs into logical DAP frames.
- [ ] Give known frames semantic function names without embedding PC/file text.
- [ ] Preserve `instructionPointerReference` and honest unknown-frame fallbacks.
- [ ] Implement DAP `startFrame`, `levels`, stable frame IDs, and `totalFrames`.
- [ ] Stop unwinding at unsupported CFI, interrupt boundaries, cycles, or unverifiable memory without appending guessed frames.
- [ ] Add Call Stack unit and real-emulator tests for a multi-function C chain and nested inline calls.

### Scopes, variables, and formatting

- [ ] Add per-frame Parameters, Locals, Statics, Globals, Registers, Flags, and Raw Stack scopes.
- [ ] Resolve active lexical scopes and variable shadowing at the selected PC.
- [ ] Evaluate register, CFA/frame-relative, memory, constant, and location-list values.
- [ ] Report optimized-out, inactive-range, unsupported-location, and memory-failure states distinctly.
- [ ] Format signed/unsigned integers, booleans, characters, and enums.
- [ ] Add pointer and function-pointer formatting with safe expansion.
- [ ] Add arrays with indexed paging.
- [ ] Add structures, unions, members, typedefs, and qualified types.
- [ ] Add recursive-type, pointer-cycle, expansion-depth, child-count, and string-length limits.
- [ ] Populate DAP `type`, `memoryReference`, `namedVariables`, and `indexedVariables` accurately.
- [ ] Add fixtures and real-emulator assertions for parameters, locals, pointers, arrays, structures, enums, and optimized-out values.

### C expressions

- [ ] Implement a non-executing C expression lexer and parser.
- [ ] Bind identifiers against the selected inline/lexical frame, statics, globals, enums, and supported registers.
- [ ] Implement scalar unary, arithmetic, shift, bitwise, comparison, and logical operations.
- [ ] Implement address-of, dereference, array indexing, member access, and pointer-member access.
- [ ] Add supported scalar/pointer casts with target-width checking.
- [ ] Return expandable typed Evaluate results and frame-specific errors.
- [ ] Support Watch and Debug Console contexts.
- [ ] Enable hover evaluation only after bounded-latency Extension Host tests pass.
- [ ] Keep function calls, assignment, and `supportsSetVariable` disabled pending separate designs.

### Source-level stepping

- [ ] Define logical source identity from physical frame, inline chain, file, line, column, discriminator, and statement flag.
- [ ] Implement source Step Into to the next distinct logical statement or entered callee/inline frame.
- [ ] Implement source Step Over constrained to the starting semantic frame depth.
- [ ] Implement inline Step Out to the containing logical frame.
- [ ] Implement physical Step Out from a verified unwind resume PC.
- [ ] Preserve user breakpoint/watchpoint/exception/script-stop precedence over step completion.
- [ ] Add temporary-breakpoint ownership and guaranteed cleanup.
- [ ] Add instruction/time budgets, cancellation, halt handling, and no-source-progress diagnostics.
- [ ] Keep instruction-granularity stepping available as a machine-level fallback.
- [ ] Advertise Step Out only when the implementation and selected frame can provide a verified caller.

### Optimized-code policy

- [ ] Test and document breakpoint relocation for lines with no emitted instructions.
- [ ] Handle multiple lines at one address and multiple ranges for one line without conflicting logical breakpoints.
- [ ] Test discontinuous function and lexical ranges.
- [ ] Test variable location transitions and gaps at `-O1` and `-O2`.
- [ ] Test nested inline headers and runtime functions in Call Stack and stepping.
- [ ] Test tail calls, merged code, and ambiguous origins without fabricating frames.
- [ ] Define and document recommended `-O0` or debug-friendly optimization flags.
- [ ] Add user-configurable source-step filters without hiding truthful Call Stack frames.

### Adapter architecture, capabilities, and verification

- [ ] Extract stop context, stack trace, scopes, variables, C expressions, stepping, and DAP handle storage from the monolithic adapter.
- [ ] Add artifact-feature detection for types, locations, inline info, and CFI.
- [ ] Add emulator capability detection for coherent registers and bounded memory reads.
- [ ] Add a stopped-generation memory cache or versioned backend snapshot if profiling shows it is required.
- [ ] Gate every semantic capability on its exact metadata/runtime prerequisites.
- [ ] Preserve machine-only ASM and incomplete-C fallback behavior.
- [ ] Add malformed-metadata, stale-handle, paging, and partial-capability tests.
- [ ] Extend the Extension Host real-emulator suite for Call Stack, frame selection, locals, Watch, and Step Into/Over/Out.
- [ ] Run v6llvmc lit/MIR tests, linked-ELF verification, v6vscode unit/integration/regression tests, real-emulator scenarios, and applicable sanitizer suites.
- [ ] Update debugging, architecture, development, project-template, ABI, optimization, and compatibility documentation.
