# Assembly Function Debugging Through Execution History

**Status:** Agreed design direction; implementation pending. No open behavioral
questions remain from this discussion.
**Date:** 2026-10-24
**Scope:** v6asm function-region metadata, v6emul history queries, and v6vscode
call-stack reconstruction and stepping.

## 1. Goal and Agreed Constraints

Provide function debugging comparable to the existing macro experience:

- Function names and caller sites in the Call Stack panel.
- Clicking a caller navigates to the instruction that transferred execution to
  its child, including a call, jump, indirect transfer, or fallthrough.
- Correct current body line and editor navigation, including nested macros.
- Breakpoints on executable body lines and navigation to entry-label definitions.
- Step In and one familiar Step Out command.
- Correct live program counter (PC) indication, independent of selected history.

Assembly functions need no conventional prologue or epilogue. Support multiple
entries, shared tails, separate bodies inside one optional block, jumps instead
of calls, and indirect transfers such as `pchl`.

Agreed constraints:

- Reuse optional blocks as function boundaries. No new function-boundary
  directives, explicit primary function name, or manual entry declarations.
- One optional block represents one function-region frame. Calls between entries
  inside that block are intentionally not registered or displayed separately.
- Recursion is unsupported, including indirect recursion. All repeated-region
  loops deliberately collapse under the logical-history model, including loops
  formed by jumps rather than conventional calls and returns.
- Recover transfer history rather than requiring stack-unwind descriptions or
  searching emulated stack memory for plausible return addresses.
- v6emul receives address ranges and history cursors, never debug metadata.
- v6emul returns both the predecessor call/jump instruction PC and the entrance
  PC. The extension does not recover either address by decoding instructions.
- Step Out is intended to leave the current function body. Do not introduce a
  separate region-exit command. Use a temporary breakpoint at the next instruction
  after the recovered caller, accepting that unconventional transfers may never
  reach it.
- Increasing the existing history-buffer capacity is the initial response to
  retention needs.

## 2. Terminology and Responsibilities

* A **function region** is the whole address range belonging to a retained optional
  block.
* A **potential entry label** is any global label defined inside an optional
  block, regardless of whether v6asm sees references to it. Here, global means
  a non-local source label, not necessarily an ELF symbol with global binding.
  An **entry label** is a potential entry matched to the recovered entrance PC.
  Several potential entries can share one region.
* A **history cursor** identifies one instruction occurrence in execution order,
  not merely its address.
* A **boundary transition** is an executed instruction outside a region followed
  immediately by arrival inside it. Its two addresses are the **predecessor PC**
  and **entry PC**.
* A **completed subcall excursion** is execution that leaves a region and later
  returns to it. Removing such excursions from the recovered history produces the
  **logical caller chain** used by this design. This chain is not a claim about
  physical return addresses or saved register frames.

| Component | Responsibility |
|---|---|
| v6asm | Emit optional-block ranges, entry-label names/addresses/definitions, and existing source/macro metadata. |
| v6emul | Record actual executed instructions and answer range/history queries without knowing functions, names, or source files. |
| v6vscode | Map PCs to regions, reconstruct the raw region chain, remove completed excursions, resolve entry names, and present/step the result. |

## 3. Optional Blocks Define Regions and Entry Names

Use the existing `.optional` / `.endoptional` block and its aliases, including
`.function` / `.endfunction` and `.func` / `.endfunc`.

```asm
.optional
draw:
    mvi a, 0
draw_fast:
    ; shared implementation
    ret
.endoptional
```

Both `draw` and `draw_fast` are potential entries of the same region. v6asm must
emit entry metadata for every global label inside the block, not only labels
referenced in the current assembly input. No explicit function-name directive
or reference-analysis result is required to include a label as a candidate.

At a stop, the extension first chooses the widest containing optional-block
range. It does not guess separate function extents from the ordering of labels.
The recovered entry PC then refines the function name and definition location.

Entry discovery is independent of pruning and section naming. In default object
mode, v6asm emits optional blocks into sections and the linker decides which
sections survive when garbage collection is enabled. A label may be referenced
only by another object file or used through an indirect transfer. Therefore,
v6asm's local reference scan cannot determine the complete entry set. Preserve
all global-label candidates for surviving regions and use the entrance PC
returned by v6emul to select the actual entry name and definition location.

Shared tails and non-overlapping implementations in one block use the same
ownership model. No static partitioning of their instruction bodies is required.
One optional block represents one function-region frame, even when one entry
calls another entry inside that block. Such internal calls do not add frames or
change the entry name recovered from the most recent outside-to-inside entrance.
The current source line still follows actual execution inside the block.

For example, if main calls A and A calls B inside the same optional block, show
the region frame named A with B's executing source line, followed by main's call
site. Do not show a separate B frame. If main later calls B directly from outside
the block, that entrance names the region frame B. This accepted limitation needs
no additional query for transfers between entries inside a region.

Optional data blocks may retain the same block metadata. They do not participate
in call-stack reconstruction unless execution actually reaches their addresses;
there is no need to exclude them merely because they contain data.

### Metadata contract

An **ELF** file is the object/executable container already used for debug output.
**DWARF** is the debug-information format carried by that ELF file.

For each retained optional block, make the following available in the final ELF:

- Stable block identity and final half-open range `[start, end)`.
- Names, addresses, and source definition locations for every global label
  inside the block, independent of references and ELF symbol binding.
- Instruction-to-source mappings and the existing macro expansion chains.
- Correct relocation of ranges and entries in linked object builds.

In object output, emit this metadata for all emitted optional-block sections,
including those with no references in the current assembly input. Final linked
metadata must not expose discarded sections as live regions or entries. Entry
metadata itself must not create a retention root for otherwise unused code.

Preserve the whole block range even when several entries share it. A consumer
must not depend on whichever overlapping function description was parsed first.
The exact DWARF representation of block identity plus several entries remains an
implementation decision; do not misrepresent runtime function transfers as macro
inline expansions.

## 4. Pruning and Output Modes

Debug metadata describes surviving code; it must not keep otherwise unused code
alive or change executable instructions.

- **Object output, current default:** v6asm emits each label-bearing optional
  block into a dedicated `.text.<label>`, `.data.<label>`, or `.bss.<label>`
  section; it does not prune the block using its local reference scan. The
  linker prunes unused sections when `--gc-sections` is enabled. Without garbage
  collection, independent section emission alone does not remove unused blocks.
- **Section naming, current behavior:** v6asm selects the first defined label
  referenced outside the block in the current assembly input, falling back to
  the first defined label. This chooses a section name, not the complete entry
  set or the block's final liveness.
- **Settings, current behavior:** `.setting optional, prune` requests assembler
  pruning even in object mode. `.setting optional, false` includes blocks in
  the current section rather than creating independently prunable sections.
  Neither setting changes this design's all-global-label entry metadata rule.
- **Direct ROM output, current behavior:** No external linker participates.
  v6asm defaults to assembler pruning based on identifiers referenced outside
  each block. This is not proof of linker-equivalent rooted reachability.
- **Design requirement for both modes:** Retained code must retain its required
  targets. In particular, fallthrough into another block is a dependency even
  without an explicit symbol reference. This requires verification and, where
  necessary, pruning changes; it is not claimed as existing behavior. Any future
  linker-equivalent ROM pruning must be implemented in v6asm itself.

The `.pack` comparison concerns reachability and independent pruning units, not
reusing its storage-placement rules for executable functions. Final debug ranges
must match the actual linked ELF or ROM companion ELF after pruning and layout.

## 5. Emulator History Query

The current v6emul trace history is a useful foundation: it stores instruction
addresses and bytes in a circular buffer with 300,000 entries. Its `pchl` handling
also records the resulting PC. The new request should query this raw execution
history, not depend on the Trace Log panel's display filters.

### Proposed request

- An address range `[start, end)`.
- A history cursor at which to start searching backward, associated with the
  stopped execution snapshot.

### Proposed response

- Predecessor PC: the most recent instruction outside the supplied range.
- Entry PC (entrance): the actual immediately following instruction address
  inside the range, including a destination reached but not yet executed at a
  breakpoint.
- Cursors for both instruction occurrences, so the next query can continue
  backward from exactly that transition.
- A history epoch identifying the current execution timeline.
- A status distinguishing a found transition, execution origin, and unavailable
  older history.

These are proposed fields, not existing protocol names. Queries run against a
coherent stopped snapshot. Reset, image reload, history replacement, or an
execution-timeline change invalidates old cursors.

The emulator only searches addresses and execution order. The extension retains
all knowledge of region ownership, entry labels, macro chains, and source lines.
The response supplies both addresses directly, even for `pchl` or fallthrough;
the extension must not reconstruct them by subtracting an instruction length,
decoding a call operand, or guessing a destination.

### Stop position: verified behavior and query rule

The current emulator completes an instruction before calling its debugger:
`Hardware::ExecuteInstruction` executes machine cycles until the instruction is
complete, then calls `Debugger::Debug`. The debugger checks breakpoints against
the resulting CPU PC and records the completed instruction's original address
in the trace buffer.

Consequently, the live stopped PC need not already be a recorded instruction.
For example, after executing `call B` at `0x0200`, a breakpoint at B's entry
`0x0300` stops with live PC `0x0300`, while the newest trace item is `0x0200`.
There is no executed `0x0300` item yet. A query using only existing trace pairs
would miss this first entrance into B.

The new emulator query must therefore treat the stopped PC as the current
destination after the newest completed instruction. It returns predecessor
`0x0200` and entrance `0x0300` in this example, with a cursor representation for
that stopped destination. Older queries use actual recorded instruction
occurrences. This is a concrete protocol requirement, not an unresolved user
choice. Verify the same behavior in breakpoint, watchpoint, and single-step tests.

Keep request ranges and returned PCs in one declared address space. The current
trace stores global instruction addresses; any CPU/global address conversion is
the emulator protocol's responsibility, not an assumption made by the extension.

The **execution origin** is the actual start of the current execution timeline.
v6emul must expose its configured initial PC and origin identity separately from
the circular history. Use the launch/CLI configuration; never assume `0x100`, and
never stop reconstruction merely because an address happens to equal the start
address again later.

History capacity can be increased as needed. Retention tuning is not a design
blocker; nevertheless, a query that runs out of retained history must not report
that as reaching the execution origin.

## 6. Reconstructing the Logical Caller Chain

### 6.1 Recover the raw chain

1. Start with the live stopped PC and the matching history position.
2. Find the widest optional region containing that PC. If none contains it,
   stop immediately: there are no function boundaries to query.
3. Ask v6emul for its preceding outside-to-inside boundary transition.
4. Record the region, entry PC, predecessor PC, and both cursors. Refine the entry
   name using the entry-label metadata.
5. Find the region containing the predecessor PC. If there is none, stop at that
   PC; do not search past unwrapped code for an older optional region. Otherwise,
   repeat from that older instruction occurrence, not from the latest position.
6. Stop on the first of: a PC outside all optional blocks, the actual execution
   origin, or the end of retained history. Preserve the termination reason.
   Retain repeated regions while gathering the raw chain; they are needed to
   recognize completed subcalls.

An outside-all-blocks PC is the terminal source/address context, not an invented
function with guessed boundaries. For example, unwrapped startup code calling A
ends reconstruction at that call site. The same rule applies to unwrapped helpers
or interrupt code; reconstruction does not jump over them. When execution is
currently outside every optional block, show only the current machine/source
context and perform no backward function-region search.

Actual execution order makes the search independent of whether entry was reached
by `call`, `jmp`, `pchl`, or fallthrough. A destination is not inferred from static
instruction operands.

### 6.2 Remove completed subcall loops

The first outside PC is a predecessor, not automatically a surviving caller.
For example:

```asm
main:
    call A
    hlt

; region A
A:
    call B
    call C
    ret

; region B
B:
    ret

; region C
C:
    nop                 ; stopped here
    ret
```

Relevant chronological execution:

```text
main -> A -> B -> A -> C
```

Raw backward region chain:

```text
C -> A(newer occurrence) -> B -> A(older occurrence) -> main
```

Because recursion is unsupported, `A -> B -> A` represents a completed excursion.
The resulting displayed chain is:

```text
C -> A -> main
```

Use region identity, not label spelling, to recognize the repeated region. For
the surviving A frame, retain its newer site that transferred to C, but recover
its invocation entry and parent from the older A occurrence. Deleting duplicate
names without merging this provenance would navigate correctly at one level
while assigning the wrong entry or parent.

Apply the same rule to nested and repeated completed excursions, retaining
history cursors throughout. The extension must examine enough history to resolve
such loops before publishing a predecessor as a caller.

Collapse every repeated-region loop deliberately, regardless of instruction kind.
For example, `A jumps to B; B jumps to A; A enters C` also reduces to `C -> A`
before continuing to A's older parent. This is the selected logical-history
policy, not an attempt to distinguish physical calls from jump-only cycles.
No return-opcode filtering or extension-side call/jump decoding is required for
this reduction. Simply deleting return records would not remove the completed
callee's earlier history anyway.

### 6.3 Jumps and indirect transfers

For `main -> A -> B` where A jumps to B and never resumes, preserve the logical
transfer chain `B -> A -> main`. It explains how execution reached B and lets
the user navigate to A's jump. Do not require A to have a saved physical frame.

For `pchl`, use the actual adjacent recorded destination as the entry PC. No
debug-metadata interpretation is needed in the emulator, and the extension does
not need a conventional return-address location to display the transfer chain.

## 7. Debugger Presentation and Stepping

### Call Stack and source navigation

- Display the current function entry name and the recovered logical callers.
- The active frame uses the current body line. Each caller uses its actual
  predecessor/transfer site, including the source of a jump or fallthrough.
- Go to Definition resolves the recovered entry-label declaration, not the
  caller's transfer site.
- Reuse existing macro inline metadata inside each function context, preserving
  nested macro body highlighting and invocation navigation.
- Keep recovered history frames distinct internally from physical machine-state
  frames. Execution history supplies PCs and navigation, not saved caller
  registers. Do not fabricate register values for historical frames.

### Breakpoints and PC

- Reuse executable line-table mappings for body breakpoints, including all
  emitted instances of a macro body statement.
- Do not treat optional directives or data-only rows as executable targets.
- The live register PC always remains the real stopped CPU PC. Selecting a
  caller changes source context, not the machine's live register state.

### Step In

Follow actual execution into the destination body, including alternate entries,
conditional transfers, `jmp`, `pchl`, and nested macros. Preserve the current
source/instruction stepping distinction.

### Step Out

Keep one Step Out command. Its user-facing objective is to leave the current
function body using the following agreed algorithm:

1. Recover the logical caller after collapsing completed subcall loops.
2. Ask v6emul for the next instruction address after that caller instruction.
   This means the sequential successor, not the executed call/jump target. The
   extension does not decode instruction lengths itself.
3. Set a debugger-owned temporary breakpoint at the returned address.
4. Resume execution; reaching that breakpoint completes Step Out.

For example, when the caller is `call B` at `0x0200`, v6emul returns `0x0203`.
Set the temporary breakpoint at `0x0203`, not at the caller instruction itself.
The caller need not belong to an optional block: a terminal call site in unwrapped
main/startup code is enough to request its successor.

**Accepted limitation:** Assume the callee eventually reaches the next instruction
after the caller. For tail jumps, fallthrough, or unusual manual calls, that
assumption may be false. No additional departure detection or tail-transfer
handling is required. Execution can continue indefinitely, leaving the temporary
breakpoint pending until it is hit or the operation is interrupted/ended. Merely
crossing a function boundary does not complete this Step Out.

- Keep existing macro Step Out behavior: leaving the active macro expansion is
  handled before stepping out of its containing function.
- Respect user breakpoints, watchpoints, pause, and cancellation; clean up
  debugger-owned stepping resources on interruption.

This stopping rule is settled; exact physical return-address recovery and special
handling for non-returning tail transfers are not implementation requirements.

## 8. Implementation Sequence

1. Emit optional-region and entry-label metadata in both assembler output modes;
   verify final addresses after pruning and relocation.
2. Add a versioned raw-history boundary query, stable cursors, and execution-origin
   information to v6emul. Keep the protocol free of debug metadata.
3. Implement and test raw chain reconstruction plus completed-excursion removal
   as extension logic independent of editor UI.
4. Integrate logical history frames with existing Call Stack, source navigation,
   macro expansion, and live-PC presentation.
5. Implement Step Out by requesting the caller's sequential successor from
   v6emul and setting a temporary breakpoint there. Preserve breakpoint/pause
   behavior and the accepted never-hit-target limitation.

## 9. Verification

| Scenario | Expected result |
|---|---|
| Straight nested calls without prologues | Correct names, entry PCs, and caller transfer sites |
| One or several completed subcalls before the current call | Completed excursions removed; no returned callee displayed as a parent |
| Nested completed excursions | Correct reduction and preservation of older entry/newer display-site provenance |
| Several global labels in one optional block | All are potential entries regardless of local references; actual entrance selects name and definition |
| Entry referenced only from another object file | Entry metadata exists before linking and resolves correctly when the block survives |
| Indirect entry with no direct reference to that label in the assembly input | Candidate metadata exists; observed entrance selects it when the block is retained |
| Unused optional block with object-mode linker garbage collection | Block removed; no discarded region/entry presented as live; debug metadata does not retain it |
| Shared tail or separate bodies in one optional block | One region frame; no guessed body partitioning |
| A calls B inside the same optional block | No separate B frame; retain outside-entry name A and highlight B's current source line |
| Later direct call to B from outside the same block | Region frame named B using the newly recovered entrance |
| `jmp`, fallthrough, and `pchl` across regions | Actual predecessor and entry recovered without emulator metadata |
| Jump-only repeated-region loop | Deliberately collapses using the same policy as a completed helper excursion |
| Macro inside function and call from macro body | Existing macro navigation and body highlighting preserved |
| Optional data block never executed | No effect on reconstructed chain |
| Object linking and direct-ROM output | Equivalent surviving-block metadata with final addresses |
| Fallthrough dependency during pruning | Target retained in both output modes |
| Non-default execution start and start address revisited | Origin identified from timeline, not a hardcoded or repeated PC |
| Predecessor or current PC outside every optional block | Search stops immediately; no older region is invented as a parent |
| Breakpoint on first instruction of a region | Emulator returns entrance from live stopped PC even though it is not recorded yet |
| Reset/reload or unavailable older history | Stale cursors rejected; incomplete chain not presented as complete |
| Normal return versus temporary helper during Step Out | Return completes; helper excursion does not |
| Tail jump/fallthrough during Step Out | Same successor breakpoint policy; continued execution and a pending breakpoint are accepted if target is never reached |
| Selecting historical caller | Correct source site; live CPU PC/registers unchanged |

Recursion is intentionally outside acceptance coverage. Keep existing macro
metadata, stack presentation, and source-stepping regression tests passing.
