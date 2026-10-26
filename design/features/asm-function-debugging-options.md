# Assembly Function Debugging Through Execution History

**Status:** Agreed design; implementation pending.
**Date:** 2026-10-24
**Scope:** v6asm function-region metadata, v6emul history queries, and v6vscode
call-stack reconstruction and stepping.

## 1. Goal and Agreed Constraints

Provide function debugging comparable to the existing macro experience:

- Function names and caller sites in the Call Stack panel.
- Clicking a caller navigates to the instruction that transferred execution to
  its child, including a call, jump, or indirect transfer.
- Correct current body line and editor navigation, including nested macros.
- Breakpoints on executable body lines and navigation to entry-label definitions.
- Step In and one familiar Step Out command.
- Correct live program counter (PC) indication, independent of selected history.

Support assembly functions with arbitrary prologues and epilogues, multiple
entries, shared tails, separate bodies inside one optional block, jumps instead
of calls, and indirect transfers such as `pchl`.

Agreed constraints:

- Use optional blocks as function boundaries and global labels as potential entries.
- Optional blocks must not fall through into each other.
- One optional block represents one function-region frame. Calls between entries
  inside that block are intentionally not registered or displayed separately.
- Recursion is unsupported, including indirect recursion. All repeated-region
  loops deliberately collapse under the logical-history model, including loops
  formed by jumps, calls, or returns.
- Recover callers from execution history.
- v6emul receives address ranges and history cursors; the extension owns debug
  metadata interpretation.
- v6emul returns both the predecessor call/jump instruction PC and the entrance
  PC.
- Step Out uses a temporary breakpoint at the next instruction
  after the recovered caller, accepting that unconventional transfers may never
  reach it.
- Increasing the existing history-buffer capacity is the initial response to
  retention needs.

## 2. Terminology and Responsibilities

* A **function region** is the whole address range belonging to a retained optional
  block.
* A **potential entry label** is any non-local source label defined inside an
  optional block. This includes labels with local or global ELF symbol binding.
  An **entry label** is a potential entry matched to the recovered entrance PC.
  Several potential entries can share one region.
* A **history cursor** identifies one instruction occurrence in execution order.
* A **boundary transition** is an executed instruction outside a region followed
  immediately by arrival inside it. Its two addresses are the **predecessor PC**
  and **entry PC**.
* A **completed subcall excursion** is execution that leaves a region and later
  returns to it. Removing such excursions from the recovered history produces the
  **logical caller chain** used by this design.

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

Both `draw` and `draw_fast` are potential entries of the same region. v6asm emits
entry metadata for every global label inside the block.

At a stop, the extension first chooses the widest containing optional-block
range.
The recovered entry PC then refines the function name and definition location.

Shared tails and non-overlapping implementations in one block use the same
ownership model.
One optional block represents one function-region frame, even when one entry
calls another entry inside that block. Such internal calls do not add frames or
change the entry name recovered from the most recent outside-to-inside entrance.
The current source line still follows actual execution inside the block.

Optional data blocks retain the same block metadata and participate in call-stack
reconstruction when execution reaches their addresses.

### Metadata contract

An **ELF** file is the object/executable container already used for debug output.
**DWARF** is the debug-information format carried by that ELF file.

For each retained optional block, make the following available in the final ELF:

- Stable block identity and final half-open range `[start, end)`.
- Names, addresses, and source definition locations for every global label
  inside the block.
- Instruction-to-source mappings and the existing macro expansion chains.
- Correct relocation of ranges and entries in linked object builds.

In object output, emit this metadata for all emitted optional-block sections.
Preserve ordinary linker code reachability when adding debug metadata.

### Relocations and discarded-code metadata

A **relocation** associates an address field in object-file metadata with its
owning code/data section and an offset within that section. A **tombstone** is
the invalid-address marker the linker writes when that referenced section is
discarded.

Use the following agreed approach for linked object output:

1. v6asm emits optional-region metadata and every global-label entry candidate.
2. Every code/data address in that metadata uses a relocation to its owning
   section. Under the default object-output strategy, this is the corresponding
   optional-block section. Sizes and other non-address fields remain values.
3. The linker resolves addresses for surviving sections and writes tombstones
   for discarded ones. The associated DWARF records may remain in the final ELF.
4. The extension recognizes tombstoned region/entry address records and excludes
   them from live lookup indexes before range matching or entry-name resolution.
   Filter invalid starts before computing range ends.

**Physically pruning metadata is outside scope.** The extension filters discarded
records while their bytes may remain in the ELF file.

For this 16-bit function-region/entry address contract, accept `0xFFFF` as the
all-ones tombstone. **Accepted limitation:** real region starts or entry labels
at address `0xFFFF` cannot be distinguished from that marker and may be excluded
from these debug indexes. Apply this marker to region-start and entry-address
fields; range ends, sizes, and live CPU registers retain their ordinary meanings.

Direct-ROM companions contain final addresses after assembler pruning and layout.

Preserve whole-block ownership when several entries share a range. The exact
DWARF representation of block identity and entries is an implementation detail.

## 4. Pruning and Output Modes

Debug metadata describes surviving code and preserves executable bytes and pruning
behavior.

- **Object output, current default:** v6asm emits each label-bearing optional
  block into a dedicated `.text.<label>`, `.data.<label>`, or `.bss.<label>`
  section. The linker prunes unused sections when `--gc-sections` is enabled.
- **Section naming, current behavior:** v6asm selects the first defined label
  referenced outside the block in the current assembly input, falling back to
  the first defined label.
- **Settings, current behavior:** `.setting optional, prune` requests assembler
  pruning even in object mode. `.setting optional, false` includes blocks in
  the current section. Both settings retain the all-global-label metadata rule.
- **Direct ROM output, current behavior:** v6asm performs assembler pruning based
  on identifiers referenced outside each block.
- **Debug layout:** Final debug ranges match the linked ELF or ROM companion
  after pruning and layout.

## 5. Emulator History Query

The current v6emul trace history is a useful foundation: it stores instruction
addresses and bytes in a circular buffer with 300,000 entries. Its `pchl` handling
also records the resulting PC. The new request queries this raw execution history.

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

Queries run against a coherent stopped snapshot. Reset, image reload, history
replacement, or an execution-timeline change invalidates old cursors.

The emulator only searches addresses and execution order. The extension retains
all knowledge of region ownership, entry labels, macro chains, and source lines.
The response supplies both addresses directly, including transfers through `pchl`.

### Stop position: verified behavior and query rule

The current emulator completes an instruction before calling its debugger:
`Hardware::ExecuteInstruction` executes machine cycles until the instruction is
complete, then calls `Debugger::Debug`. The debugger checks breakpoints against
the resulting CPU PC and records the completed instruction's original address
in the trace buffer.

Consequently, the live stopped PC need not already be a recorded instruction.
For example, after executing `call B` at `0x0200`, a breakpoint at B's entry
`0x0300` stops with live PC `0x0300`, while the newest trace item is `0x0200`.

The new emulator query must therefore treat the stopped PC as the current
destination after the newest completed instruction. It returns predecessor
`0x0200` and entrance `0x0300` in this example, with a cursor representation for
that stopped destination. Older queries use actual recorded instruction
occurrences. Verify this behavior in breakpoint, watchpoint, and single-step tests.

Keep request ranges and returned PCs in one declared address space. The current
trace stores global instruction addresses; any CPU/global address conversion is
the emulator protocol's responsibility.

The **execution origin** is the actual start of the current execution timeline.
v6emul must expose its configured initial PC and origin identity separately from
the circular history. Identify the origin by timeline position and the configured
launch/CLI address.

Increase history capacity as needed. Report exhausted history and execution origin
as distinct query outcomes.

## 6. Reconstructing the Logical Caller Chain

### 6.1 Recover the raw chain

1. Start with the live stopped PC and the matching history position.
2. Find the widest optional region containing that PC. Stop if none contains it.
3. Ask v6emul for its preceding outside-to-inside boundary transition.
4. Record the region, entry PC, predecessor PC, and both cursors. Refine the entry
   name using the entry-label metadata.
5. Find the region containing the predecessor PC. If there is none, stop at that
   PC. Otherwise, repeat from that older instruction occurrence.
6. Stop on the first of: a PC outside all optional blocks, the actual execution
   origin, or the end of retained history. Preserve the termination reason.
   Retain repeated regions while gathering the raw chain; they are needed to
   recognize completed subcalls.

An outside-all-blocks PC is the terminal source/address context. Unwrapped startup
code calling A
ends reconstruction at that call site. The same rule applies to unwrapped helpers
or interrupt code. When execution is
currently outside every optional block, show only the current machine/source
context.

Actual execution order makes the search independent of whether entry was reached
by `call`, `jmp`, or `pchl`.

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

Use region identity to recognize the repeated region. For
the surviving A frame, retain its newer site that transferred to C, but recover
its invocation entry and parent from the older A occurrence.

Apply the same rule to nested and repeated completed excursions, retaining
history cursors throughout. The extension must examine enough history to resolve
such loops before publishing a predecessor as a caller.

Collapse every repeated-region loop deliberately, regardless of instruction kind.
For example, `A jumps to B; B jumps to A; A enters C` also reduces to `C -> A`
before continuing to A's older parent.

### 6.3 Jumps and indirect transfers

For `main -> A -> B` where A jumps to B and never resumes, preserve the logical
transfer chain `B -> A -> main`. It explains how execution reached B and lets
the user navigate to A's jump.

For `pchl`, use the actual adjacent recorded destination as the entry PC.

## 7. Debugger Presentation and Stepping

### Call Stack and source navigation

- Display the current function entry name and the recovered logical callers.
- The active frame uses the current body line. Each caller uses its actual
  predecessor/transfer site, including the source of a jump.
- Go to Definition resolves the recovered entry-label declaration.
- Reuse existing macro inline metadata inside each function context, preserving
  nested macro body highlighting and invocation navigation.
- History frames supply PCs and navigation. Show historical caller registers as
  unavailable unless independently recovered.

### Breakpoints and PC

- Reuse executable line-table mappings for body breakpoints, including all
  emitted instances of a macro body statement.
- The live register PC always remains the real stopped CPU PC. Selecting a
  caller changes source context while preserving live register state.

### Step In

Follow actual execution into the destination body, including alternate entries,
conditional transfers, `jmp`, `pchl`, and nested macros. Preserve the current
source/instruction stepping distinction.

### Step Out

Keep one Step Out command. Its user-facing objective is to leave the current
function body using the following agreed algorithm:

1. Recover the logical caller after collapsing completed subcall loops.
2. Ask v6emul for the next instruction address after that caller instruction.
   v6emul computes this sequential successor from the instruction length.
3. Set a debugger-owned temporary breakpoint at the returned address.
4. Resume execution; reaching that breakpoint completes Step Out.

For example, when the caller is `call B` at `0x0200`, v6emul returns `0x0203`.
Set the temporary breakpoint at `0x0203`. A terminal caller in unwrapped main/startup
code also supplies a valid site for requesting the successor.

**Accepted limitation:** Assume the callee eventually reaches the next instruction
after the caller. For tail jumps or unusual manual calls, that
assumption may be false. Execution can continue indefinitely, leaving the temporary
breakpoint pending until it is hit or the operation is interrupted/ended.

- Keep existing macro Step Out behavior: leaving the active macro expansion is
  handled before stepping out of its containing function.
- Respect user breakpoints, watchpoints, pause, and cancellation; clean up
  debugger-owned stepping resources on interruption.

## 8. Implementation Sequence

1. Emit optional-region and entry-label metadata in both assembler output modes;
   use owning-section relocations in object output and exclude linker-tombstoned
   regions/entries from extension indexes. Verify final surviving addresses.
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
| DWARF records retained for a discarded optional section | Linker tombstones relocated addresses; extension filters records without requiring physical metadata removal |
| Region start or entry label at `0xFFFF` | Accepted ambiguity: may be excluded as a tombstone |
| Tombstoned start combined with nonzero region size | No wrapped or fabricated live range enters the index |
| Shared tail or separate bodies in one optional block | One region frame |
| A calls B inside the same optional block | No separate B frame; retain outside-entry name A and highlight B's current source line |
| Later direct call to B from outside the same block | Region frame named B using the newly recovered entrance |
| `jmp` and `pchl` across regions | Actual predecessor and entry recovered without emulator metadata |
| Jump-only repeated-region loop | Deliberately collapses using the same policy as a completed helper excursion |
| Macro inside function and call from macro body | Existing macro navigation and body highlighting preserved |
| Optional data block never executed | No effect on reconstructed chain |
| Object linking and direct-ROM output | Equivalent surviving-block metadata with final addresses |
| Non-default execution start and start address revisited | Origin identified from timeline, not a hardcoded or repeated PC |
| Predecessor or current PC outside every optional block | Search stops immediately; no older region is invented as a parent |
| Breakpoint on first instruction of a region | Emulator returns entrance from live stopped PC even though it is not recorded yet |
| Reset/reload or unavailable older history | Stale cursors rejected; incomplete chain not presented as complete |
| Normal return versus temporary helper during Step Out | Return completes; helper excursion does not |
| Tail jump during Step Out | Same successor breakpoint policy; continued execution and a pending breakpoint are accepted if target is never reached |
| Selecting historical caller | Correct source site; live CPU PC/registers unchanged |

Recursion is intentionally outside acceptance coverage. Keep existing macro
metadata, stack presentation, and source-stepping regression tests passing.
