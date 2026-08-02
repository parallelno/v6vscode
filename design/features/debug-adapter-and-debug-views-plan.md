# V6 Debug Adapter and Debug Views Implementation Plan

Status: Proposed
Owner: v6vscode / v6emul maintainers
Last updated: 2026-07-30

Checkboxes: `[x]` complete; `[~]` partially implemented with acceptance work remaining; `[ ]` not complete.

## 1. Problem

### Current behavior

The extension can launch `v6emul`, send serialized request/response IPC commands, render emulator frames, and pause or resume execution. It does not register a VS Code debugger, create a debug session, translate source locations to machine addresses, or publish Debug Adapter Protocol (DAP) events.

The current user-visible CPU statistics implementation opens an editor webview after a manual pause. Registers, flags, breakpoints, watchpoints, memory, stack data, and hardware state are not integrated with the Run and Debug experience.

The backend declares debugger commands `DEBUG_ATTACH` through `DEBUG_TRACE_LOG_DISABLE` in `v6core/include/core/hardware_consts.h`. Ordinary hardware state requests such as `GET_REGS` and `GET_HW_MAIN_STATS` work in server mode, but they are implemented by `Hardware` and do not prove that `dev::Debugger` is installed. A live check against the current debug build confirmed that those requests, `STOP`, and `DEBUG_ATTACH` succeed, while the first real debugger operation, `DEBUG_BREAKPOINT_ADD`, does not return. Source inspection agrees: server startup constructs `Hardware`, while the `dev::Debugger` constructor is what installs `Hardware::Debug` and `Hardware::DebugReqHandling`. Server mode must construct a long-lived `Debugger` by default and prove the contract with an add/list/delete breakpoint round trip.

The TCP protocol uses synchronous request/response MessagePack. The extension serializes requests. Breakpoint or watchpoint stops are externally visible only as a transition from running to stopped, and the backend does not expose a reliable stop reason or hit identifier.

The external toolchains can produce final ELF debug companions: `v6asm -g` emits DWARF v4 line metadata and symbols for direct ROM builds or relocatable objects, and V6C Clang/LLD preserves final linked DWARF and symbols for C and mixed C/ASM builds. The final ELF contains authoritative 16-bit CPU addresses and is sufficient for source breakpoints, PC-to-source mapping, and function/symbol lookup. The current v6vscode project templates do not yet consistently request and retain these artifacts; updating those templates and consuming the resulting ELF files are extension-repository work. C local-variable locations and call-frame unwind rules are not currently emitted, so native locals and semantic multi-frame stack traces remain outside the initial implementation.

### Desired behavior

A user can create or select a `Vector-06C` launch configuration and start a professional VS Code debug session that:

1. Launches a project.
2. Publishes one machine thread and accurate running, continued, stopped, exited, and terminated state.
3. Supports pause, continue, restart, step-in, step-over, and instruction stepping.
4. Resolves ASM source breakpoints to executable addresses and synchronizes their verified state with `v6emul`.
5. Exposes CPU registers and condition flags in the native Variables panel.
6. Supports Watch expressions for registers, symbols, addresses, and memory reads.
7. Exposes meaningful stack frames when metadata permits and an honest single CPU frame otherwise.
8. Supports DAP data breakpoints backed by emulator watchpoints.
9. Provides a compact Hex Viewer in the Run and Debug sidebar with bank-aware memory navigation and editing.
10. Provides a compact Hardware Statistics view in the Run and Debug sidebar for CPU, display, stack, mapping, palette, ports, and drive state.
11. Coexists with the emulator display panel without socket races, duplicate lifecycle ownership, or frame polling starving debugger requests.
12. Fails explicitly when the backend or debug metadata lacks a required capability.

### Root cause

The extension was designed as an emulator launcher and display client, not as a debugger. It lacks:

- A verified backend debugger instance in `v6emul` server mode.
- Structured, versioned debugger wire contracts.
- Reliable stop-reason and hit data.
- Efficient bulk memory access.
- A session coordinator shared by emulator UI and debugger services.
- A DAP implementation and VS Code debugger contribution.
- An ELF/DWARF consumer and index for the debug metadata emitted by the toolchain.
- Debug-sidebar providers for hardware-specific views.
- Integration and real-emulator tests for debugging behavior.

## 2. Strategy

### Approach: staged in-process DAP with backend capability upgrades

Implement an in-process TypeScript debug adapter registered through `vscode.debug.registerDebugAdapterDescriptorFactory`. Keep DAP request handling separate from emulator transport and lifecycle code. Introduce one session coordinator that owns the emulator process, the single IPC connection, request priorities, state observation, and teardown.

Use standard DAP surfaces where semantics match:

- Debug lifecycle, threads, continued/stopped events.
- Pause, continue, step-in, next, restart, and disconnect.
- Source and instruction breakpoints.
- Stack trace, scopes, Variables, Watch evaluation, and memory references.
- Data breakpoints for basic read/write watchpoints.

Use custom views contributed to the built-in Run and Debug container where machine-specific behavior does not fit DAP:

- Bank-aware Hex Viewer with hex/ASCII columns and optional access overlays.
- Hardware Statistics tree for registers summary, raw stack, timing, display, palette, ports, RAM-disk mapping, FDC, and mounted drives.
- Advanced breakpoint/watchpoint editing only if standard DAP fields cannot represent page masks, ranges, value conditions, or comments.

Upgrade `v6emul` before depending on debugger commands. Prefer structured JSON fields over exposing compiler-dependent packed C++ bitfields. Add capability negotiation and reliable stop information. Keep compatibility with older emulator builds by detecting capabilities and disabling unsupported features with actionable errors.

### Why this works

An in-process adapter avoids another process and can share extension services, logging, project discovery, and lifecycle ownership. A coordinator prevents the existing frame loop and debugger from independently controlling one single-client server. Standard DAP requests make native VS Code panels behave correctly, while custom sidebar views preserve Vector-06C-specific data without forcing it into misleading generic abstractions.

Backend-first sequencing removes the largest correctness risk: building a frontend against debug commands that are declared but not installed. The final linked ELF provides source locations and symbols, while capability gates avoid presenting raw stack words as semantic call frames or claiming C locals that have no emitted locations.

### Summary of changes

#### v6emul

- Construct and retain `dev::Debugger` in server mode.
- Add capability/version negotiation.
- Add structured breakpoint and watchpoint requests/responses.
- Add a monotonic debug stop record containing reason and hit identifiers.
- Add efficient bulk global-memory reads and optional access-history reads.
- Define reset, attach, launch, reconnect, and ownership semantics.
- Add backend unit and IPC contract tests.

#### v6vscode

- Add typed debugger protocol models.
- Add an emulator session coordinator and prioritized request scheduler.
- Register `Vector-06C` launch/attach configurations and an inline DAP adapter.
- Add final-ELF, DWARF line-table, and symbol services.
- Add debug-artifact discovery and update generated project templates to retain final ELF companions.
- Implement execution, breakpoints, stack/scopes/variables, evaluate, memory, and data-breakpoint DAP requests.
- Replace the editor CPU statistics webview with Run and Debug sidebar views.
- Add Hex Viewer and Hardware Statistics providers.
- Add unit, integration, regression, extension-host, and real-emulator feature tests.
- Update user and developer documentation.

## 3. Implementation Steps

### Step 3.1 - Read and freeze reference behavior [x]

Reference review completed for planning:

- `v6vscode/design/feature_plan_prompt.md`.
- `v6vscode/design/design.md` and `design/references/old_implementation.md`.
- Current extension lifecycle, IPC client, project model, emulator panel, tests, and package contributions.
- `v6core/include/core/hardware_consts.h`, `hardware.h`, `debugger.h`, `breakpoint.h`, and `watchpoint.h`.
- `v6core/src/hardware.cpp`, `debugger.cpp`, breakpoint/watchpoint implementations, recorder, memory, CPU, and display code.
- `v6emul/app/main.cpp` and `server_mode.cpp`.
- Devector execution controls, hardware statistics, breakpoint, watchpoint, hex viewer, memory display, and scheduler behavior under `devector/src/main_imgui`.
- v6asm DWARF debug metadata, listing documentation, and current generated Makefiles.
- V6C Clang/LLD DWARF metadata, calling convention, code generation, register allocation, and documented metadata limitations.

Record a protocol behavior table in `docs/debug-protocol.md` before implementation. For every command used by the adapter, specify request fields, response fields, state prerequisites, side effects, error behavior, and minimum backend capability version.

> **Design Notes**: The requested `v6core/include/core/hardware.cpp` path does not exist; the implementation is `v6core/src/hardware.cpp`. The feature prompt references `tests/features/README.md`, lit tests, mirror sync, and a `result.txt` workflow that are absent from this extension. Step 3.18 establishes repository-appropriate equivalents rather than silently dropping those requirements.
>
> **Implementation Notes**:

### Step 3.2 - Enable and verify the v6emul server debugger [x]

In the `v6emul` repository:

1. Construct a long-lived `dev::Debugger` by default after `Hardware` and before entering server mode. Select and document recorder capacity.
2. Ensure destruction order keeps `Hardware` alive while `Debugger` detaches.
3. Reject debug requests with a structured `debugger_not_available` error if callbacks are not installed; never invoke an empty function target.
4. Define `DEBUG_ATTACH` behavior for attach, detach, reconnect, reset, ROM reload, FDD boot, and process shutdown.
5. Invoke `DEBUG_RESET` at deterministic hardware reload boundaries, with explicit recorder-reset policy.
6. Fix or document `EXECUTE_FRAME` command 8; do not leave a declared command silently routed to the default debug handler.
7. Verify `EXECUTE_FRAME_NO_BREAKS` semantics. Either truly bypass debugger breaks or rename/version the capability to reflect actual behavior.
8. Add server-mode tests proving `DEBUG_ATTACH`, breakpoint add/list/delete, watchpoint add/list/delete, breakpoint stop, watchpoint stop, and detach execute without crashes, hangs, or empty callbacks.

Acceptance gate:

- `GET_REGS` and `GET_HW_MAIN_STATS` succeed, then a breakpoint can be added with `DEBUG_BREAKPOINT_ADD`, observed with `DEBUG_BREAKPOINT_GET_ALL`, removed, and confirmed absent through the same TCP connection.
- A test ROM can attach, add a breakpoint, run, stop at the expected PC, remove the breakpoint, and detach through the TCP server.
- A watchpoint can stop execution on a known memory access.
- Unsupported debug commands return errors rather than successful empty responses.

> **Design Notes**: This is an external prerequisite only for DAP operations that invoke backend debugger commands. It does not block implementation or testing of the v6vscode DAP skeleton, ELF/DWARF consumer, artifact resolver, or source mapping. The 2026-07-29 live check reached `GET_REGS`, `GET_HW_MAIN_STATS`, `STOP`, and `DEBUG_ATTACH`, but `DEBUG_BREAKPOINT_ADD` timed out; register/statistics aggregation alone is not evidence that `dev::Debugger` callbacks are installed.
>
> **Implementation Notes**: Debugger initialization fixed in v6emul on 2026-07-29. Live verification confirmed the full add/list/status/delete/confirm-empty sequence completes without hangs. Exact wire proof:
> - `DEBUG_BREAKPOINT_ADD {data0:8589934591, data1:0, data2:4660, comment:"dap-verify"}` → `{"data":null,"ok":true}`
> - `DEBUG_BREAKPOINT_GET_ALL` → `[{data0:8589934591, data1:0, data2:4660, comment:"dap-verify"}]`
> - `DEBUG_BREAKPOINT_GET_STATUS {addr:4660}` → `{"status":0}`
> - Second `ADD` at addr 256, `GET_ALL` returns both entries.
> - `DEBUG_BREAKPOINT_DEL {addr:4660}` removes first; `GET_ALL` returns single remaining entry.
> - `DEBUG_BREAKPOINT_DEL {addr:256}` removes second; `GET_ALL` returns `null` (empty collection).
> - `DEBUG_ATTACH {data:false}` and `RUN` succeed. Server stayed stable throughout.

### Step 3.3 - Version and harden the backend debug protocol [ ]

Add a capability query to the IPC protocol. Return at minimum:

- Protocol version and emulator version.
- Debugger availability.
- Structured breakpoint/watchpoint support.
- Stop-info support.
- Bulk-memory read/write limits.
- Memory access-history support.
- Recorder/reverse-execution support.
- Maximum global address and RAM-disk geometry.

Replace packed bitfield wire payloads with structured requests. Preserve old commands temporarily for Devector compatibility, but make new clients use stable fields such as:

- Breakpoint: address, memory-page mask, enabled, temporary, operand, condition, value, comment, owner.
- Watchpoint: stable ID, global address, length, access, condition, value, type, enabled, comment, owner.

For reliable DAP event attribution, add a stop-info endpoint or extend the status response with a monotonic stop sequence and:

- Reason: pause, breakpoint, data breakpoint, instruction step, next, frame step, entry, halt, reset, emulator exit, exception, or unknown.
- Current PC and global instruction address.
- Hit breakpoint address/ID when applicable.
- Hit watchpoint ID, accessed global address, access type, old/new value when applicable.
- Optional textual description.

This backend addition is not required to detect that execution stopped: v6vscode can poll `IS_RUNNING` and observe a `true -> false` transition. It is required before the adapter claims accurate DAP stop reasons, identifies which data breakpoint fired, or distinguishes manual pause, breakpoint, watchpoint, step, `HLT`, reset, and other stop causes. A breakpoint address can sometimes be inferred by comparing PC with the active breakpoint list, but that is ambiguous for overlapping causes and cannot reliably identify watchpoints because their transient hit state is consumed inside the backend.

Add bulk memory operations:

- `GET_MEM { addr, len } -> { addr, data }` using command 93 and the emulator's linear global memory address space.
- `WRITE_MEMORY_GLOBAL { globalAddr, data } -> { bytesWritten }`.
- Optional `GET_MEMORY_ACCESS_HISTORY { globalAddr, length }` for read/write overlays.

Add malformed-request tests, bounds tests, reconnect tests, and compatibility tests. Document maximum payload sizes and whether reads are coherent only while stopped.

> **Design Notes**: The existing synchronous request/response transport remains unchanged. The adapter polls a monotonic stop sequence while execution is running and emits the corresponding DAP event to VS Code.
>
> **Implementation Notes**:

### Step 3.4 - Package and verify the required emulator build [ ]

1. Build `v6emul` with the debugger-enabled server changes.
2. Add a command/capability smoke check to the extension startup path.
3. Verify the external emulator identified by `V6EMUL` using the repository's smoke-test process.
4. Record the required minimum emulator protocol and binary version.
5. Fail debug launch with an actionable message when the emulator identified by `V6EMUL` is older or lacks required capabilities.
6. Keep ordinary Run Project behavior available when only non-debug capabilities are present.

Acceptance gate:

- Packaged VSIX resolves a verified external debugger-capable emulator through `V6EMUL`.
- External binaries produce deterministic compatibility messages.

> **Implementation Notes**:

### Step 3.5 - Define debug configuration and session ownership [~]

Add a `Vector-06C` debugger contribution in `package.json`:

- Debug type: `v6`.
- Labels and initial configurations.
- `launch` and `attach` request schemas.
- Activation event for debug resolution if required by the supported VS Code version.
- Configuration snippets for ASM ROM, FDD, and attach.

Initial launch fields:

- `type`, `request`, `name`.
- `project` or `program`.
- `cwd`.
- `bootRom`, `loadAddress`, `speed`, and `viewMode` overrides.
- `debugArtifact`, the final linked or direct-build companion ELF path.
- `stopOnEntry`.
- `trace`.

Initial attach fields:

- `host`, `port`.
- `debugArtifact`, the final linked or direct-build companion ELF path.
- Optional project association.
- Whether disconnect should terminate or leave the emulator running.

Implement a `DebugConfigurationProvider` that:

1. Resolves defaults from the active `*.project.json`.
2. Delegates final-ELF selection to a `DebugArtifactResolver`, using explicit `debugArtifact` first and a same-stem sibling ELF only when the loaded ROM and build workflow make that relationship unambiguous.
3. Assigns a free port for launch instead of assuming `9876`.
4. Rejects incompatible combinations early.
5. Keeps debug-only settings in `launch.json` initially; add project-schema fields only after stable use cases are proven.

Define one ownership matrix for Run Project, debug launch, debug attach, emulator panel close, debug disconnect, restart, and extension deactivation. Closing the display panel terminates an active debug launch and closes its debug session.

> **Design Notes**: Attach must never send `EXIT` unless explicitly configured. Launch owns its child process and normally terminates it on disconnect.
>
> **Implementation Notes**: Registered the `v6` debugger, launch/attach schemas and snippets, inline adapter factory, and active-project defaults. `run.debugArtifact` is supported in the project schema and supplies the default ELF. Debug launch uses a free port. Explicit artifact discovery, the complete ownership matrix, restart, and remaining configuration fields/tests are still open.

### Step 3.6 - Introduce an emulator session coordinator [~]

Refactor the current direct lifecycle/client usage behind an `EmulatorSessionCoordinator`:

- Sole owner of launch/attach, process, socket, connection state, debug attachment, and shutdown.
- Serialized request scheduler with priorities: execution control and stop detection; breakpoint/watchpoint synchronization; variables/memory; hardware telemetry; video frames.
- Cancellation and timeout support per request.
- State machine with `idle`, `launching`, `connecting`, `paused`, `running`, `terminating`, and `terminated`.
- Events for state, stop record, process exit, protocol error, frame availability, and capability changes.
- Reference-counted consumers or explicit session leases for DAP, display panel, Hex Viewer, and Hardware Statistics.

Move frame polling to a low-priority consumer and throttle or suspend it when debugger control traffic is pending. Coalesce duplicate telemetry reads after a stop. Ensure only one observer polls running/stop state.

Add coordinator tests for concurrent frame/stat/register requests, launch failure, disconnect, cancellation, process exit, and ownership transitions.

> **Design Notes**: The existing `IpcClient` correctly serializes requests, but it has no priorities, cancellation, or session ownership. Keep encoding/transport separate from coordination.
>
> **Implementation Notes**: `EmulatorLifecycle` now acts as the shared launch-session owner for Run Project and DAP launch. The adapter and display panel share one `IpcClient`; debug launch uses a free port; closing the panel terminates a debug-owned process, and debug termination closes the panel. `IpcClient` has stable critical/high/normal/low queue priorities and frames are low priority. Ownership/state and queue-order tests pass. Attach sharing, cancellation, leases, richer state/events, telemetry coalescing, and failure/soak coverage remain open.

### Step 3.7 - Add typed debug protocol models [ ]

Create typed modules under `src/emulator/protocol/` for:

- Capabilities and stop info.
- Breakpoint requests/responses.
- Watchpoint requests/responses.
- Register, stack, memory, mapping, display, palette, port, FDC, and drive responses.
- Protocol-level enums for reasons, conditions, operands, access modes, memory spaces, and status.

Add runtime validation at the IPC boundary. Do not trust decoded MessagePack casts. Reject missing fields, invalid enum values, unsafe integers, oversized lengths, and malformed binary data with `V6Error` codes that identify the command.

Add codec contract tests using recorded/golden backend responses. Include null/empty breakpoint and watchpoint collections, which currently serialize differently from populated arrays.

> **Implementation Notes**:

### Step 3.8 - Implement the DAP adapter skeleton and lifecycle [~]

Add `@vscode/debugadapter` and `@vscode/debugprotocol` as runtime dependencies, pinned to compatible versions. Implement an inline adapter with focused components rather than one monolithic session class:

- `V6DebugSession`: DAP request/event boundary.
- `V6DebugRuntime`: execution state and coordinator facade.
- `SourceMapService`: source/address mapping.
- `BreakpointService`: desired/verified breakpoint reconciliation.
- `VariableService`: scopes, variables, evaluate, and memory references.
- `WatchpointService`: DAP data-breakpoint reconciliation.

Implement and test:

- `initialize` capabilities.
- `launch`, `attach`, `configurationDone`.
- `threads` with one stable machine thread ID.
- `disconnect`, `terminate`, and `restart` ownership semantics.
- `continued`, `stopped`, `exited`, `terminated`, and `output` events.
- Consistent 1-based VS Code lines/columns and 16-bit/20-bit address formatting.

Do not advertise unsupported DAP capabilities. Enable each capability only in the step that implements and tests it.

> **Implementation Notes**: An inline TypeScript adapter implements initialize, launch, attach, configurationDone, one thread, disconnect/terminate, continued/stopped/exited/terminated/output events, and shared lifecycle launch ownership. It remains a single class without the planned service decomposition; restart and broader lifecycle tests remain open.

### Step 3.9 - Implement execution control and stopped events [~]

Map DAP requests:

- `continue` -> `RUN` and immediate `ContinuedEvent` after backend acknowledgement.
- `pause` -> `STOP`, await stop sequence, emit `StoppedEvent('pause')`.
- `next` -> backend step-over address plus an adapter-owned temporary breakpoint, or a structured backend next operation if added.
- `stepIn` -> ensure paused, execute exactly one instruction, emit `StoppedEvent('step')`.
- `stepOut` -> only advertise when unwind/call metadata can produce a verified return address; otherwise return a clear unsupported response.
- `restart` -> coordinated image reload, debug reset, breakpoint/watchpoint reapplication, and optional stop-on-entry.

Poll stop information while running with an adaptive interval, initially 10-20 ms active and slower when the window is unfocused only if stop latency remains acceptable. Stop polling immediately after a new stop sequence and coalesce register/source refreshes.

Prevent races:

- Serialize pause/continue/step transitions.
- Reject or queue step operations while running.
- Remove temporary next breakpoints on completion, cancellation, disconnect, and unrelated stops.
- Distinguish user breakpoints from adapter-owned temporary breakpoints.
- Handle `HLT`, emulator process exit, socket loss, and backend errors without leaving VS Code in a running state.

Add latency instrumentation from backend stop sequence to DAP `StoppedEvent`.

Acceptance targets:

- Median stopped-event latency under 30 ms and p95 under 75 ms on the development machine with frame rendering active.
- Single-step changes PC exactly once for deterministic test instructions.
- No orphan temporary breakpoint after 1,000 next operations.

> **Implementation Notes**: Continue, pause, instruction step, and basic next are implemented with 20 ms `IS_RUNNING` polling. Shared lifecycle state drives display frame polling, and control/poll requests outrank frames. Exact backend stop records, restart, robust race handling, latency instrumentation, and soak acceptance remain blocked or open.

### Step 3.10 - Consume final ELF debug metadata in v6vscode [~]

This step is owned and implemented in this repository. Add the parser and immutable indexes under `src/debug/metadata/`, artifact selection under `src/debug/artifacts/`, and the debugger-facing mapping policy under `src/debug/source/`. Implement a pure TypeScript reader for the supported ELF32/DWARF v4 subset, or adopt a maintained pure JavaScript/WASM parser after validating it against V6C's 16-bit address size. Avoid native dependencies in the VSIX.

Read only the final linked ELF or the direct-ROM companion ELF, never relocatable objects as the session's authoritative map. Parse and validate:

- ELF header, section table, executable/allocatable sections, and 16-bit V6C address model.
- `.debug_line` directory/file tables, statement rows, line, column, sequence boundaries, and final instruction addresses.
- `.symtab`/`.strtab` names, bindings, types, sizes, section ownership, and final addresses.
- `.debug_info`, `.debug_abbrev`, and `.debug_str` compilation units and subprograms when present; use `.symtab` as the required function/symbol source because direct-ASM companions may contain only a minimal compilation unit.

Build immutable session indexes for:

- Source file, line, and optional column to one or more executable instruction addresses.
- CPU address to the applicable source statement row and enclosing function symbol.
- Symbol name to final address, size, type, and binding.

Define breakpoint resolution rules:

1. Use only `is_stmt` rows in final executable sections.
2. Preserve all addresses when one source line expands to several instructions, including loops and macro invocations.
3. Use column information to distinguish multiple instructions on one physical line when supplied by VS Code.
4. Resolve an empty/non-executable line to the next statement row in the same source file only, and return the relocated verified line.
5. Reject discarded sections, addresses outside `0x0000-0xFFFF`, malformed paths, and ambiguous files with actionable messages.

Support both toolchain workflows:

- Direct ASM ROM: consume the companion ELF emitted by `v6asm -g`; its absolute addresses and `.text` bytes correspond to the ROM.
- Linked ASM, C, or mixed C/ASM: consume the final ELF produced by LLD; linked virtual addresses are already CPU addresses and must not receive an additional ROM-base adjustment.

Validate that the debug artifact matches the loaded ROM by comparing the flat ROM against bytes reconstructed from the final ELF's loadable/allocatable sections, including defined gaps. Reject stale or mismatched companions before verifying source breakpoints. For FDD launch, require an explicit ELF plus the built/extracted ROM payload or a build manifest; do not compare ELF code bytes directly with the FDD container.

Acceptance gate:

- Direct-ROM ASM includes, macros, loops, and multiple instructions per line map deterministically in both directions.
- Linked ASM, C, and mixed C/ASM fixtures resolve final relocated addresses after LLD.
- Code discarded by `--gc-sections` cannot become a breakpoint target.
- ROM/ELF mismatch is detected before execution begins.
- C source breakpoints, stopped-line highlighting, and function names work at `-O0`; optimized mappings follow emitted DWARF rows without guessing removed statements.

> **Design Notes**: Current metadata is sufficient for source breakpoints, current-line display, and symbol/function lookup. It does not include C variable locations, lexical-block locals, or `.debug_frame`/`.eh_frame` unwind rules. The initial adapter therefore exposes CPU registers, flags, symbols, memory, and one current CPU frame; semantic C locals, caller frames, and reliable step-out remain future toolchain work.
>
> **Implementation Notes**: Implemented pure TypeScript ELF32, DWARF v4 line-table, symbol, immutable source/address index, Windows path reconciliation, project-level ELF selection, and direct-ROM byte validation. Missing, malformed, and mismatched companions fail explicitly before breakpoint verification. Direct-ASM fixture conformance passes; linked ASM/C/mixed fixtures, section-gap reconstruction, discarded-section checks, and full DWARF compilation-unit parsing remain open.

### Step 3.11 - Synchronize source and instruction breakpoints [~]

Implement DAP `setBreakpoints`, `setInstructionBreakpoints`, and `breakpointLocations`:

1. Maintain desired breakpoint sets per source and session.
2. Convert source locations through `SourceMapService`.
3. Use structured backend breakpoints with an adapter owner ID.
4. Reconcile additions, updates, and removals without `DEL_ALL`, which may delete Devector or user-owned backend breakpoints.
5. Return verified addresses/lines and precise rejection messages.
6. Support basic conditions and hit conditions only when their semantics can be translated exactly.
7. Reapply desired breakpoints after restart/reload and emit DAP `BreakpointEvent` when verification changes.
8. Match stop records to DAP breakpoint IDs.

Advanced page masks, register operands, comparison values, auto-delete behavior, and comments should be exposed through optional custom commands/view editing, not silently flattened into standard source breakpoints.

Add tests for duplicate addresses, several source lines mapping to one address, one source line mapping to several addresses, disabled mappings, temporary-next collisions, reconnect, and external backend breakpoint changes.

> **Implementation Notes**: Source and instruction breakpoints resolve to CPU addresses, are added through the backend, return verified lines/address messages, and contribute inferred hit IDs. Desired-set reconciliation, removals per source, restart reapplication, breakpoint events, ownership-safe structured backend IDs, conditions, and collision tests remain open.

### Step 3.12 - Implement stack traces, scopes, registers, variables, and Watch evaluation [~]

Implement an honest staged stack model:

- Always return one current CPU frame with PC, mapped source, instruction pointer reference, and a stable frame ID.
- Add semantic caller frames only when debug metadata and calling-convention-specific unwind rules can verify return addresses and frame bounds.
- Never present raw words around SP as confirmed call frames.

Scopes for the current frame:

- Registers: A, F, B, C, D, E, H, L, AF, BC, DE, HL, SP, PC, M.
- Flags: S, Z, AC, P, CY.
- Interrupts: INTE, IFF, HLTA and packed interrupt state.
- Stack sample: words at SP-10 through SP+10, clearly labeled as raw stack memory.
- Symbols/locals/globals only when metadata defines their location and lifetime.

Implement `variables`, `evaluate`, `setExpression`/`setVariable` only where supported, and `completions` if expression syntax stabilizes. Initial Watch expression grammar should support:

- Register and flag names.
- Numeric literals in decimal, `0x`, `$`, and suffix forms accepted by project tools.
- Symbol names.
- Unary memory reads such as `byte[address]`, `word[address]`, and explicit global/banked forms.
- Basic arithmetic and bitwise operators with bounded evaluation and no arbitrary JavaScript execution.

Return `memoryReference` values for registers or symbols that denote addresses. Mark unavailable/optimized-out variables explicitly. Do not advertise register writes until the backend offers a validated register-write command.

Add unit tests for flag decoding, register splitting, expression precedence, invalid expressions, memory bounds, symbol shadowing, variable-reference lifetime, and stale frame IDs.

> **Implementation Notes**: Implemented one honest CPU frame with local source path and instruction pointer, register/flag/raw-stack scopes, and evaluation of register names plus decimal/hex literals. Raw Stack sends the current SP to the backend and decodes words at SP-10 through SP+10. Symbols, memory expressions, arithmetic, interrupt scope, write operations, semantic callers, and C locals remain open or metadata-limited.

### Step 3.13 - Implement watchpoints through DAP data breakpoints [ ]

The authoritative custom panel design and implementation status are recorded in `watchpoints-panel-plan.md`. The panel CRUD workflow is implemented independently of DAP hit attribution.

Implement:

- `dataBreakpointInfo` for address-bearing variables, symbols, and Watch expressions.
- `setDataBreakpoints` for basic read, write, and read/write access.
- Stable adapter-generated IDs mapped to structured backend watchpoint IDs.
- Reconciliation without deleting externally owned watchpoints.
- DAP stopped reason `data breakpoint` with hit ID and access description from backend stop info.

Define the standard subset:

- One address or contiguous range.
- Access type.
- Optional value condition only when translated exactly.

Expose Devector-compatible advanced fields in an optional custom Watchpoints view/editor:

- Global address and RAM-disk bank.
- `LEN` versus `WORD` semantics.
- Length, value, condition, enabled state, and comment.

Test boundary-crossing ranges, word accesses split across an instruction, overlapping watchpoints, stable IDs after edits, read-only memory edits, and stop-reason accuracy.

> **Implementation Notes**: The V6 Watchpoints Run and Debug panel now provides structured schema-1 add, command-94 edit, enable/disable, delete, bulk actions, bounded memory previews, and typed Hex Viewer navigation through a shared `WatchpointService`. DAP `dataBreakpointInfo`, `setDataBreakpoints`, and accurate `stopped` hit attribution remain open because the backend does not expose watchpoint hit identity.

### Step 3.14 - Implement DAP memory support and the Hex Viewer [ ]

The authoritative Hex Viewer design is `hex-viewer-panel-plan.md`. Implement the initial viewer as read-only. Byte editing and DAP `writeMemory` belong to the separate future editing phase defined there and require a validated backend write protocol.

Implement DAP `readMemory` using bulk backend operations:

- Parse versioned memory references rather than raw unchecked strings.
- Support main RAM and all RAM-disk/global spaces.
- Return unreadable byte counts correctly.
- Allow coherent live reads only if the backend capability guarantees them.

Contribute the `V6 Hex Viewer` webview view to the built-in Run and Debug container according to `hex-viewer-panel-plan.md`. In summary:

- Maintain the complete Main RAM plus 32 RAM-disk-bank cache in the extension for the active session.
- Request only the selected bank's currently visible interval; search ranges affect navigation/highlighting only.
- Render virtualized 16-byte rows with address, uppercase hex bytes, symbols, search/history, context actions, and keyboard access.
- Refresh the visible interval once per second while running and only while the view is visible.
- Keep symbols and **Find in Source** restricted to Main RAM until debug metadata becomes bank-aware.

Acceptance targets:

- Opening or updating the view fetches only the selected bank's visible interval, with no prefetch or search-range reads.
- Scrolling a 64 KiB bank remains responsive and does not allocate a DOM node per byte for the whole bank.
- A visible-interval read of up to 1 KiB completes within 100 ms locally at p95 while the display panel is active.

> **Implementation Notes**:

### Step 3.15 - Implement the Hardware Statistics debug-sidebar view [~]

Replace the editor-tab `CpuStatisticsPanel` with a `TreeDataProvider` contributed as `V6 Hardware Statistics` under Run and Debug. Reuse pure formatting logic, but obtain data through the coordinator and cache one paused-state snapshot.

Tree groups and fields, based on Devector:

- CPU: AF, BC, DE, HL split and paired; SP, PC, M.
- Flags: C, P, AC, Z, S.
- Interrupts: INTE, IFF, HLTA.
- Raw Stack: SP-10 through SP+10 words.
- Timing/Display: uptime, CPU cycles, last run duration if backend exposes it, CRT X/Y, frame cycles, frame number, display mode, vertical scroll, Rus/Lat, actual speed.
- Palette: 16 entries with color icons/swatches and hardware/RGB detail in descriptions/tooltips.
- Ports: summarized IN/OUT state with commands or child rows for full 256-byte histories.
- Memory Mapping: RAM-disk index, RAM/stack mode and page mappings.
- FDC and Drives A-D: drive, side, track, position, transfer length, mounted state, read/write counts, and path tooltip.

Behavior:

- Immediate refresh on each new stop sequence.
- Optional 1 Hz refresh while running only when the view is visible; show cached values as running/stale.
- Collapsed groups do not trigger expensive detail requests.
- Manual refresh command in the view title.
- No automatic editor webview opening on pause.
- Dispose the old `CpuStatisticsPanel` after the sidebar view reaches parity; retain its pure formatter only if tests or shared formatting still need it.

Add provider tests for grouping, formatting, stale/running context, lazy requests, and refresh coalescing.

> **Implementation Notes**: Added `V6 Hardware Statistics` as a Run and Debug `TreeDataProvider` with CPU registers, flags, execution counters, interrupt summary, and display state. It refreshes from the shared client on pause, shows running/stale state, and has a manual refresh command. Automatic CPU-statistics editor tabs were removed. Raw stack, palette, ports, mappings, FDC/drives, visibility-aware lazy requests, and full provider lifecycle tests remain open.

### Step 3.16 - Integrate custom views, context keys, and commands [ ]

Add package contributions and commands for:

- Hex Viewer and Hardware Statistics views in the `debug` container.
- Refresh, go-to PC, go-to address, copy address/value, edit byte, and add data breakpoint.
- Optional Step Frame and Step 0x100 commands, exposed through debug toolbar/menu contributions only while a V6 session is paused.

Maintain context keys such as:

- `v6.debug.active`, `v6.debug.running`, `v6.debug.paused`.
- `v6.debug.supportsWatchpoints`, `supportsMemoryHistory`, `supportsRecorder`.
- `v6.hexViewer.canEdit`.

Commands must route through the active session coordinator, not discover sockets or instantiate clients themselves. Handle zero or multiple V6 sessions explicitly.

Add accessibility labels, keyboard navigation, focus behavior, high-contrast support, and compact sidebar layouts. Do not use editor webviews for data that belongs in the Run and Debug sidebar.

> **Implementation Notes**:

### Step 3.17 - Build and static validation [~]

Run from `v6vscode`:

```powershell
npm install
npm run compile
npm run lint
```

Run backend formatting/static checks and the documented CMake build for `v6emul`. Treat warnings introduced by debugger changes as failures. Verify the packaged extension with:

```powershell
npm run package
```

Inspect the VSIX contents to confirm runtime DAP dependencies, contributed view assets, and the compatible `v6emul` binary are included.

> **Implementation Notes**: `npm run compile`, `npm run lint`, unit tests, regression tests, metadata feature conformance, and `npm run package` pass. The VSIX contains compiled debug modules, the Hardware Statistics view, schema, runtime MessagePack dependency, and resources. Lint reports existing warnings but no errors. Backend formatting/build checks, debugger-capability packaging verification, and clean-install smoke testing remain open.

### Step 3.18 - Establish feature-test verification artifacts [~]

The planning guide requires verification through `tests/features/README.md` and a `result.txt`, but this repository currently has neither `tests/` nor feature-test conventions. Establish the equivalent under the existing singular `test/` root:

1. Add `test/features/README.md` documenting prerequisites, fixture assembly, emulator launch, extension-host execution, expected results, cleanup, and how to update results.
2. Add deterministic direct-ASM, linked-ASM, C, and mixed C/ASM fixture sources with expected final ELF source/address mappings under `test/fixtures/debug-metadata/`.
3. Build them with the actual `v6asm`, V6C Clang, LLD, and `llvm-objcopy` tools, not hand-authored ROMs, and record tool versions.
4. Add `test/features/debug-metadata/run.ps1` for real-toolchain producer/consumer conformance and `test/features/debug-adapter/run.ps1` for the real-emulator DAP scenario, both without interactive input.
5. Write machine-readable output to each feature directory's `result.txt` only after its assertions pass. Include versions, passed scenario IDs, latency where applicable, and artifact hashes; exclude timestamps and machine-specific absolute paths.
6. Add a package script such as `test:feature:debug`.
7. Decide whether CI runs the real-emulator suite on every change or as a gated Windows job.

The ELF/DWARF consumer fixtures and conformance runner are v6vscode-owned implementation, not prerequisites to be supplied by v6asm or V6C. Producer repositories retain responsibility for producer unit/lit tests. This step is the repository-appropriate replacement for the requested lit-test and result workflow. No LLVM `lit` dependency should be introduced here because the extension uses Mocha, VS Code Extension Host, and CLI smoke tests.

> **Implementation Notes**: Added `test/features/README.md`, metadata and debug-adapter PowerShell entry points, npm scripts, deterministic result policy, and a passing direct-ASM ELF/ROM conformance result with hashes. The real-emulator runner fails explicitly without writing a result because its scenario is not implemented. Linked ASM/C/mixed fixtures, producer version recording, and CI policy remain open.

### Step 3.19 - Unit tests [~]

Expand fast unit coverage for:

- Every typed protocol request/response and runtime validator.
- Capability negotiation and old-backend rejection.
- Coordinator priorities, cancellation, and ownership.
- DAP initialize/configuration/lifecycle state transitions.
- ELF/DWARF parsing, ROM/ELF validation, and bidirectional source/address mappings.
- Breakpoint and watchpoint reconciliation.
- Stop reason conversion and temporary breakpoint cleanup.
- Register, flag, raw stack, scope, and variable formatting.
- Watch expression parsing/evaluation.
- Memory-reference parsing and bounds.
- Hardware Statistics tree generation and lazy loading.
- Hex Viewer address, paging, selection, full-cache, viewport-read, and rendering models. Editing belongs to its separate future phase.

Use a stateful mock TCP server that models running state, PC changes, break/watch hits, memory, stop sequences, and backend errors. Do not rely on generic success responses for debugger tests.

> **Implementation Notes**: Coverage now includes shared-session ownership, control-over-frame queue priority, Hardware Statistics grouping, ELF/DWARF parsing and bidirectional mapping, and missing/malformed/mismatched artifacts. Full adapter lifecycle, cancellation, capabilities, watchpoints, memory, Hex Viewer, and stateful stop-record coverage remain open.

### Step 3.20 - Integration and extension-host tests [ ]

Add a real `test/integration/` suite for the existing `test:integration` script. Verify in Extension Development Host:

- Debugger registration and configuration resolution.
- Launch and attach session startup.
- Breakpoint gutter synchronization and verified state.
- Continue, pause, step, next, restart, and stop events.
- Variables, Watch evaluation, stack frame source location, and `readMemory`. Add `writeMemory` coverage only with the separate future editing phase.
- Data breakpoint setup and hit event.
- Run and Debug sidebar view registration and refresh.
- Display panel coexistence and panel close behavior.
- Disconnect ownership for launch versus attach.

Use an in-process fake adapter/backend for deterministic UI contract tests and reserve the actual emulator for Step 3.22.

> **Implementation Notes**:

### Step 3.21 - Run regression tests [~]

Add regression coverage for:

- Existing Run Project behavior without a debug session.
- ROM and FDD launch/reload.
- FDD persistence on the new ownership paths.
- Emulator panel frame rendering and keyboard input during debugging.
- Panel close/reopen without terminating debug.
- Port selection and collision recovery.
- Missing/incompatible emulator binary.
- Missing, stale, malformed, or mismatched final ELF companions.
- ASM includes, loops, macros, duplicate source lines, direct companions, linked relocation, mixed C/ASM, and garbage-collected sections.
- External backend breakpoints/watchpoints not owned by DAP.
- Socket loss, emulator crash, extension deactivation, and reconnect.
- Repeated launch/disconnect cycles without listeners, timers, panels, or processes leaking.

Run:

```powershell
npm run test:unit
npm run test:regression
npm run test:integration
npm run test:all
npm run ci
```

> **Implementation Notes**: Existing regression suites remain available and focused unit regressions cover panel-close ownership and artifact failures. The complete matrix in this step, especially extension-host display coexistence, restart/reconnect, repeated-cycle leak checks, linked metadata, and backend capability failures, remains open.

### Step 3.22 - Real-emulator feature verification [ ]

Using the fixture and procedure from `test/features/README.md`:

1. Build direct ASM, linked ASM, C, and mixed C/ASM fixtures and retain each final ELF debug companion.
2. Launch `v6emul --serve` through the extension coordinator.
3. Verify stop-on-entry and current source line.
4. Set source and instruction breakpoints; continue and verify PC, source, and stop reason.
5. Step in and next across straight-line code, branches, calls, and returns.
6. Read registers, flags, raw stack, symbols, and memory through DAP.
7. Evaluate Watch expressions.
8. Add read and write data breakpoints and verify exact hit information.
9. Edit memory through DAP and Hex Viewer and verify backend state.
10. Verify Hardware Statistics values against direct backend responses.
11. Keep the emulator display panel active and measure stop and memory latency.
12. Restart, verify breakpoint/watchpoint restoration, then disconnect and confirm cleanup.
13. Create `test/features/debug-adapter/result.txt` only if every assertion succeeds.

For v6asm and V6C themselves, run their documented producer tests when pinning or updating fixture tool versions. v6vscode owns the consumer conformance assertions and expected mappings. For v6emul, run its CMake/CTest suite plus server-mode debugger tests.

> **Implementation Notes**:

### Step 3.23 - Performance and soak verification [ ]

Measure with display, Hex Viewer, Hardware Statistics, Variables, and Watch all active:

- Stop-event latency median and p95.
- 256-byte and 4 KiB memory read latency.
- Frame throughput impact while running.
- IPC queue depth and starvation.
- Extension-host CPU and heap growth.
- Backend CPU impact from stop polling and access history.

Soak scenarios:

- 30 minutes running with visible frame and statistics.
- 10,000 single steps.
- 1,000 next operations.
- 100 restart cycles.
- Repeated Hex Viewer scrolling across all banks.
- Repeated breakpoint/watchpoint replace operations.

Acceptance targets must be recorded in `result.txt`. Investigate unbounded listeners, timers, DOM nodes, queued requests, backend debug records, and retained variable handles.

> **Implementation Notes**:

### Step 3.24 - Documentation and design synchronization [~]

Update:

- `README.md`: debug quick start, launch/attach examples, sidebar views, supported ASM/C levels, and backend version requirements.
- `docs/architecture.md`: DAP boundaries, coordinator ownership, state/event flow, and custom views.
- `docs/emulator.md`: debug-capable server, transport scheduling, protocol negotiation, and panel coexistence.
- `docs/debugging.md` (new): configurations, controls, breakpoints, watchpoints, expressions, Hex Viewer, statistics, limitations, and troubleshooting.
- `docs/debug-protocol.md` (new): authoritative extension/backend contracts.
- `docs/project-system.md`: only if project schema gains debug fields.
- `docs/commands.md`: debug commands and interaction with Run Project.
- `docs/development.md`: DAP architecture, tests, real-emulator fixture, and packaging.
- `design/design.md`: move implemented debug features out of Future Plans and document remaining metadata limitations.
- v6emul protocol and CLI documentation: debugger availability and capability query.
- v6asm/v6c documentation: debug metadata schema and generation flags.

Include a Mermaid lifecycle diagram and a sequence diagram for continue -> backend break -> stop-info poll -> DAP stopped event.

> **Implementation Notes**: Added `docs/debugging.md` and updated project-system, emulator, architecture, development, and docs index content for project ELF fields, shared socket ownership, request priorities, display coexistence, Hardware Statistics, artifact failures, and current limitations. Protocol documentation, commands/README/design synchronization, external repository docs, and the stop-info sequence diagram remain open.

### Step 3.25 - Result verification against design expectations [ ]

Perform a requirement-by-requirement review:

- Debug configuration/session lifecycle works for launch and attach.
- Pause/continue/step requests are deterministic.
- Stack frames are accurate for supported metadata and explicitly limited otherwise.
- Registers and flags appear in Variables.
- Source/instruction breakpoints synchronize and produce stopped events.
- Watchpoints produce data-breakpoint stops with hit details.
- Hex Viewer is compact, bank-aware, editable while paused, and performant.
- Hardware Statistics appears in Run and Debug, refreshes on pause, and does not open an editor tab.
- Existing emulator workflows remain functional.

Mark each applicable implementation step complete only after its tests, docs, and implementation notes are filled. Record intentionally deferred C/unwind or advanced-machine semantics as explicit limitations, not completed requirements.

> **Implementation Notes**:

### Step 3.26 - Sync bundled artifacts and release readiness [ ]

The guide's “Sync mirror” requirement has no repository-defined mirror. Treat synchronization as:

1. Sync protocol constants and documentation between v6core, v6emul IPC, and v6vscode typed commands.
2. Sync the verified `v6emul` binary into extension resources.
3. Sync generated project templates with v6asm/v6c metadata flags.
4. Confirm package lock and VSIX runtime dependencies.
5. Run clean checkout installation, CI, feature verification, and package installation.
6. Add release notes including backend compatibility, supported debug levels, and known limitations.

Do not mark this step complete until the packaged VSIX, not only the source checkout, passes the debug smoke scenario.

> **Implementation Notes**:

## 4. Expected Results

### Example 1 - Native ASM debugging

A user presses F5 on an ASM project. VS Code launches the emulator identified by `V6EMUL`, verifies protocol capabilities, loads the ROM and metadata, stops on entry, highlights the current source line, and displays registers and flags in Variables. Gutter breakpoints become verified and stop at mapped addresses.

### Example 2 - Deterministic stepping

From a paused call instruction, Step Into executes one instruction and stops at the callee. Step Over uses an adapter-owned temporary breakpoint and stops at the verified fall-through address. VS Code receives accurate `step` or `breakpoint` reasons without leaving temporary breakpoints behind.

### Example 3 - Memory debugging

A user opens V6 Hex Viewer in Run and Debug, selects a RAM-disk bank, navigates to a symbol, and sees synchronized hex/ASCII data. While paused, editing a byte updates emulator memory and invalidates relevant variables. A write data breakpoint then stops on the exact address and reports the access.

### Example 4 - Hardware inspection

On pause, V6 Hardware Statistics refreshes CPU, flags, interrupt state, raw stack, timing, raster, palette, mappings, FDC, and drive data in compact collapsible groups. No editor tab opens, and collapsed expensive groups perform no requests.

### Example 5 - Honest capability boundaries

An ASM project with stale metadata receives an unverified breakpoint with a clear artifact mismatch. A C project without variable/unwind metadata can still use instruction debugging and registers, but the extension does not fabricate locals or call frames.

## 5. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Server-mode debugger callbacks are absent | Complete and test Step 3.2 before backend-dependent DAP execution tests; continue local implementation of the adapter, metadata consumer, artifact resolver, and source mapping with mocks and fixtures. |
| Packed C++ bitfields are unstable wire contracts | Add structured, versioned breakpoint/watchpoint commands; retain packed commands only for compatibility. |
| Frame polling starves control requests | Central coordinator with priorities, coalescing, visibility throttles, and queue metrics. |
| Two services terminate the same emulator | One ownership matrix and coordinator; launch and attach have distinct disconnect semantics. |
| ELF/DWARF parsing mishandles V6C's 16-bit addresses or line sequences | Test the parser against direct, linked, mixed-language, include, macro, loop, column, sparse-layout, and garbage-collected fixtures generated by the real tools. |
| C locals/call stack cannot be reconstructed | Limit initial C debugging to source lines, functions, registers, symbols, and memory; require variable-location and unwind metadata before advertising locals or caller frames. |
| Temporary step-over breakpoint collides with user breakpoint | Track owner and temporary identity in backend; reconcile without deleting user state. |
| Watchpoint stop identity is unavailable | Extend backend stop info with watchpoint ID/address/access/value before enabling DAP data breakpoints. |
| Memory reads are too chatty | Add binary bulk reads, visible-range caching, prefetch limits, and latency tests. |
| Running-state statistics create excessive traffic | Refresh paused snapshots immediately; live refresh only when visible and throttled; lazy collapsed groups. |
| Old emulator override silently misbehaves | Capability negotiation and minimum-version errors with non-debug fallback. |
| Register edits corrupt CPU state | Do not advertise setVariable until backend provides validated register writes and tests. |
| Backend and extension constants drift | Contract tests, shared protocol documentation, capability versions, and release sync checklist. |
| Extension-host tests become flaky | Separate deterministic fake-backend integration tests from gated real-emulator feature tests. |
| Debug features regress ordinary Run Project | Maintain regression coverage and isolate debug ownership behind coordinator leases. |
| Recorder reverse execution is state-incomplete | Keep reverse operations disabled until backend guarantees and tests define restored state. |

## 6. Relationship to Other Improvements

This feature implements or enables the debug-related Future Plans currently listed in `design/design.md`: debug symbols, source mapping, runtime symbol resolution, control flow, breakpoint UI, watchpoints, debug registers, and parts of hot reload.

It also creates reusable infrastructure for:

- Source hovers showing live symbol values.
- Current-line and data-access editor decorations.
- Instruction opcode and operand tooltips.
- Trace logging and code-performance views.
- Recorder-backed reverse frame navigation.
- ROM hot reload with breakpoint preservation.
- Better Devector/v6emul/v6vscode protocol interoperability.

The ELF/DWARF consumer provides ASM and C source debugging and can later support symbol navigation. The coordinator improves current frame streaming and lifecycle correctness even outside debug sessions.

## 7. Future Enhancements

1. Backend-native next, step-out, and run-to-address commands.
2. Instruction-granular reverse execution and DAP `stepBack`/`reverseContinue`.
3. Register and flag editing through `setVariable`.
4. Semantic C call stacks, locals, optimized variable locations, and inline frames.
5. Disassembly request support and a mixed source/instruction view.
6. Advanced breakpoint UI for memory mappings, register conditions, hit counts, and logpoints.
7. Advanced watchpoint UI for ranges, WORD semantics, value conditions, and comments.
8. RAM heatmap/memory-display webview with read/write history.
9. Trace log, code performance, scripts, and recorder timeline views.
10. Multi-session support and remote/non-loopback attach with authentication policy.
11. Hot reload with artifact diffing, metadata replacement, and verified breakpoint remapping.

## 8. References

### v6vscode

- `design/feature_plan_prompt.md`
- `design/design.md`
- `design/references/old_implementation.md`
- `src/extension.ts`
- `src/emulator/client/ipc-client.ts`
- `src/emulator/lifecycle/emulator-lifecycle.ts`
- `src/emulator/protocol/ipc-commands.ts`
- `src/emulator/panel/emulator-panel.ts`
- `src/emulator/panel/cpu-statistics-panel.ts`
- `src/project/model/v6-project.ts`
- `config/schemas/v6.project.schema.json`
- `res/v6asm/docs/cli.md`
- `res/v6asm/docs/listing.md`
- `C:/Work/Programming/v6asm/docs/debug-metadata.md`
- `C:/Work/Programming/v6llvmc/docs/V6CDebugMetadata.md`
- `res/v6c/docs/calling_convention.md`
- `res/v6c/docs/regalloc.md`
- `docs/architecture.md`
- `docs/emulator.md`
- `docs/development.md`

### v6emul / v6core

- `libs/v6core/include/core/hardware_consts.h`
- `libs/v6core/include/core/hardware.h`
- `libs/v6core/include/core/debugger.h`
- `libs/v6core/include/core/breakpoint.h`
- `libs/v6core/include/core/watchpoint.h`
- `libs/v6core/src/hardware.cpp`
- `libs/v6core/src/debugger.cpp`
- `libs/v6core/src/breakpoints.cpp`
- `libs/v6core/src/watchpoints.cpp`
- `libs/v6core/src/recorder.cpp`
- `app/main.cpp`
- `app/server_mode.cpp`
- `libs/v6ipc/include/ipc/protocol.h`
- `docs/ipc-protocol.md`

### Devector behavioral reference

- `src/main_imgui/main/ui/disasm_window.cpp`
- `src/main_imgui/main/ui/hardware_stats_window.cpp`
- `src/main_imgui/main/ui/breakpoints_window.cpp`
- `src/main_imgui/main/ui/breakpoints_popup.cpp`
- `src/main_imgui/main/ui/watchpoints_window.cpp`
- `src/main_imgui/main/ui/watchpoints_popup.cpp`
- `src/main_imgui/main/ui/hex_viewer_window.cpp`
- `src/main_imgui/main/ui/mem_display_window.cpp`
- `src/main_imgui/main/scheduler.cpp`
- `src/main_imgui/main/devector_app.cpp`

### External specifications

- Microsoft Debug Adapter Protocol overview and specification.
- VS Code debugger extension API and debugger contribution documentation.
- VS Code Tree View and Webview View extension guides.
