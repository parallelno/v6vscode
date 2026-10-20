# Architecture, Code Reuse, and Maintainability Improvement Plan

**Status:** Approved for staged implementation; R01-R04 complete in stage 1; R05/R06 complete as a two-feature pilot in stage 2; R07 complete in stage 3; R08 complete in stage 4; R09 complete in stage 5; R10 complete in stage 6; R11 complete in stage 7; R12 complete in stage 8; R13 complete in stage 9. R14-R24 remain pending.
**Audit date:** 2026-10-18 (workspace session; some validation timestamps are 2026-10-19 UTC).
**Owner:** v6vscode maintainers.
**Repository:** `C:\Work\Programming\v6vscode`.
**Scope:** extension activation, project/configuration, language services, emulator transport/lifecycle/display, debugger/metadata, debug tools and browser assets, tests, packaging, and development workflow.

## Contents

- [Executive assessment](#1-executive-assessment)
- [Audit evidence and limitations](#2-audit-method-evidence-and-limitations)
- [Strengths to preserve](#3-strengths-to-preserve)
- [Architectural issues](#4-architectural-issues-and-impact)
- [Dependency boundaries](#5-dependency-and-module-structure-analysis)
- [Duplication hotspots](#6-code-duplication-hotspots-and-extraction-decisions)
- [Execution paths to unify](#7-similar-features-that-should-share-an-execution-path)
- [Shared utilities and services](#8-shared-utilitiesservices-to-introduce-incrementally)
- [Engineering improvements](#9-engineering-improvements-beyond-duplication)
- [Verification strategy](#10-testability-and-verification-strategy)
- [Prioritized roadmap](#11-prioritized-refactoring-roadmap)
- [Migration and acceptance](#12-migration-rules-acceptance-criteria-and-measures)
- [Risks and non-goals](#13-risks-and-non-goals)
- [Recommended decision](#14-recommended-decision)

## Implementation progress — stage 1

The audit observations below describe the original snapshot; the following status records the first implemented stage without rewriting that historical evidence.

| Task | Status | Implemented result |
|---|---|---|
| R01 | Complete | One terminal IPC failure path detaches the stream, rejects active/queued work without dispatch, coalesces connect attempts, cancels pending connects, validates bounded frames, limits queued count/bytes and separates queue-wait/on-wire deadlines. No mutation replay. |
| R02 | Complete | Shared typed scalar interpretation for formatting/evaluation, encoding-led signedness, casts applied before further operations, preserved sign/high words for computed 32-bit values, correct DW_FORM block1 code and block/block1 advancement tests. |
| R03 | Complete | Exposed handle IDs are not reused on reset/clear; explicit IDs reserve the allocation high-water mark; delayed Variables requests cannot resolve to newer-stop objects. |
| R04 | Complete | Portable mandatory ASM/C ELF fixtures, source/artifact hashes and producer provenance, shared source/compiled fixture paths and derived ROMs, zero optional decoder skips, direct real-emulator check moved to explicit conformance, metadata runner independent of local temp builds. |

Stage 1 verification: 627 unit tests passing with no skips after deleting generated ROMs and unsetting V6EMUL; 62 regression tests passing; 16 selected compiled fixture/correctness tests passing; six real Extension Host/emulator tests passing; one direct live unwind/memory conformance passing; metadata feature runner passing. Explicit conformance without V6EMUL fails as intended. Host/test compilation passes; lint remains at zero errors and the existing 66 warnings.

Limitations remain explicit: full C mixed signed/unsigned promotion rules are not implemented by this correction; scalar expression results beyond the supported 32-bit representation now fail instead of silently truncating. Transport failure requires reconnect/restart; no higher-level automatic recovery or session coordinator is added here. Default resource caps are documented and constructor-overridable. Browser assets/UI are unchanged. No new regressions were observed in the executed checks.

**Stage 1 commit:** `b2894cd` — `Harden IPC ordering, typed values, handle identity, and test fixtures`. No broad lifecycle, UI or parser consolidation was included. Subsequent approved stages remain separately reviewable; no push or PR submission is authorized.

## Implementation progress — stage 2

R05/R06 are implemented in **Performance and Memory Edits** first. Their feature-specific acknowledgement, restore, running-state and reconciliation policies remain local; the other debug tools are not silently migrated.

| Task | Status | Implemented result |
|---|---|---|
| R05 | Complete (two-feature pilot) | Browser-safe primitive validators and `ValidationError`; checked IPC envelopes/data with `ProtocolError` retaining command, kind, code, details, field/reason and decoder cause. Both codecs/services use the shared implementation. Serializable diagnostics reach both panel message contracts; Performance address errors use structured fields rather than guessing from message prose. |
| R06 | Complete (two-feature pilot) | Narrow session observation, command transport and timer-clock ports; composed per-scope transaction queues and keyed single-flight refreshes. Connection identity is captured at submission and checked at execution, IPC dispatch, response completion and snapshot publication. Replacement sessions have independent queue/refresh keys; stale work is not replayed. Disposal invalidates pending work and detaches listeners idempotently. |

Production transport exposes a monotonic connection epoch and rechecks an optional operation scope immediately before sending queued commands. A stale active result is consumed and rejected without assigning it to a newer request or unnecessarily failing an otherwise healthy stream. Injectable deadlines retain separate queue-wait/on-wire behavior and have a manual-clock test. Panel continuations, confirmations and address-expression updates are guarded against replacement sessions/panels; stale results do not publish success/errors into the replacement UI.

Stage 2 verification: **669 unit tests with zero skips**, 62 regressions, six real Extension Host/emulator tests, and two live conformance tests (existing DWARF unwind plus real Performance/Memory Edits add/update/delete/restore transactions). Host and full test compilation pass; 59 focused compiled shared/service/panel/transport tests pass. CI passes; lint remains at zero errors and the pre-existing 66 warnings. The existing ASM hover/Watch/Globals/struct-pool integration continues to pass.

Intentional behavior changes: concurrent Memory Edits refreshes now coalesce within a session; malformed replies surface structured protocol failures; disconnected/disposed/old-session operations reject rather than crossing into a new session. No layout, public command, project JSON or IPC schema changes. No automatic mutation retry or rollback of already-sent commands is introduced. A pending operation settles when its guarded continuation or bounded transport deadline runs; invalidation is not remote cancellation. Custom transports must provide connection identity and honor the supplied dispatch scope. Shared artifact/symbol ownership remains for R11; browser build/panel-shell consolidation remains for R15/R16.

## Implementation progress — stage 3 (R07)

Shared unsigned decimal/explicit-hex conversion and minimum-digit hex formatting now serve host queries, palette input, address expressions, debugger address formatting, and Memory Edits/Watchpoints browser consumers. Feature range checks and error wording remain local: byte (0..255), CPU (0..65535), global-address limits, expression symbol lookup and explicit machine wrapping are not conflated. Both browser entry points import an ESM build of the same TypeScript numeric implementation; the standard compile/prepublish path emits it, resource roots/CSP allow it, and a packaged real webview test executes it. This is a narrow browser-safe build seed, not completion of R15's full browser checking/migration.

The duplicated ASM string/comment maskers now use one offset-preserving helper. Existing double-quote toggling, semicolon handling and single-quote policy are retained. One intentional correctness fix preserves UTF-16 positions after astral characters inside masked strings. No UI layout or public schema changes.

Verification: 676 unit tests, zero skips; 62 regressions; seven packaged Extension Host/emulator tests including the new CSP-restricted numeric ESM smoke and existing hover/value/stepping checks. CI/host/browser-shared compilation pass; lint remains at zero errors and the existing 66 warnings. Shared host/ESM literal vectors, explicit range/width policy checks and ASM offset tests pass.

Stage 3 commit: `7439dfc` — `Share numeric mechanics across host and browser and preserve ASM offsets`.

## Implementation progress — stage 4 (R08)

Removed runtime replacement of lifecycle.stop. Registered participants are awaited after CPU pause and before EXIT, with connection/program identity guards through FDD info/export/reset exchanges. Loaded program/read-only policy is recorded for run, debug and run reload, rather than looking up the current active project during stop. Concurrent stops coalesce; completed stops and participant disposal are idempotent. Start/restart waits for an in-progress stop. The run path now uses the same identity-guarded process monitor as debug so an old exit callback cannot clear its replacement.

Failure policy is deliberate: required persistence failure rejects normal stop/restart before EXIT or cleanup, allowing retry; DAP termination/disconnect returns a failure response without destroying the retryable session. Extension deactivate awaits shutdown before disposing its store; host shutdown logs persistence errors and proceeds with teardown. Detach skips save/termination. Unexpected process loss cannot save an image after the stream is gone. Existing best-effort persistIfNeeded remains for compatibility; the registered participant uses the failure-propagating path. This does not add multi-drive automatic save, atomic file replacement, remote cancellation or a broad lifecycle coordinator.

Verification: 688 unit tests, zero skips; 62 regressions; seven real Extension Host/emulator tests; two live conformance tests. Host/browser-shared and full test typechecks pass; lint retains the existing 66 warnings with zero errors. New stop tests perform real temporary-file writes through run/display/restart/shutdown and debug-loaded paths, exercise concurrent stops, read-only/detach, stale scopes, export/write failures and retry; DAP tests verify failure responses and retry. Existing cross-surface hover/value and stepping checks pass.

Stage 4 commit: `682fe12` — `Await scoped stop participants and preserve retryable FDD saves`.

## Implementation progress — stage 5 (R09)

Corrected the declared VS Code floor from 1.85 to **1.90.0**. Stable 1.85-1.89 declarations do not expose the selected-stack APIs used by hover; 1.90 does. Pinned @types/vscode to exactly 1.90.0 and aligned the lockfile so compile checks cannot silently use newer APIs. Added an explicit minimum-version integration command and version assertion, alongside current/package smoke; documented evidence and execution in `C:\Work\Programming\v6vscode\docs\architecture-verification.md`.

TypeScript-AST gates now distinguish type-only versus runtime imports/exports/require/dynamic-import edges, prohibit new core-to-panel dependencies, reject runtime VS Code in pure metadata/codecs/utilities/shared code, and keep shared modules inside the browser-safe dependency boundary. Four existing adapter-to-panel references are explicitly type-only and named as temporary exceptions for R14/R18. Manifest tests check command/menu/settings/debugger/view IDs, duplicate contributions, engine/type/lock agreement and browser resource build/package rules. No new production dependency or core-to-view runtime edge was introduced.

Verification: 692 unit tests, zero skips; 62 regressions; two live conformance tests; full host/test/browser-shared compilation and CI pass; zero lint errors with the pre-existing 66 warnings. Seven real Extension Host/emulator tests pass on 1.90.0 from source, seven pass from the packaged VSIX on current stable, and all seven pass from the packaged VSIX on 1.90.0. The package smoke executes numeric ESM under webview CSP and retains existing ASM value/hover and C breakpoint/stepping coverage. No new regressions were observed in these checks. Network/cache prerequisites and broader future browser checking remain explicit.

Stage 5 commit: `3f9f8c7` — `Verify VS Code API floor and enforce architecture contracts`.

## Implementation progress — stage 6 (R10)

The session coordinator now owns run/debug/borrowed-attach connection establishment, common metadata/PING negotiation, debugger attachment, process monitoring, scope leases and teardown. EmulatorLifecycle remains an import-compatible facade, not a second state owner. An immutable snapshot separates connection, execution, ownership and mode. Attach no longer creates an invisible private DAP socket: shared feature observers see its negotiated session. Borrowed attach shutdown detaches without persistence/EXIT; attach refuses to silently replace a live owned process. Owned launch termination retains R08 save/retry behavior.

Connection transitions serialize, reject superseded pending opens and cancel in-progress connection attempts; post-await and wire-dispatch guards prevent negotiation/reload/command crossover. DAP uses an origin-bound lease and guards lifecycle execution/program updates; old adapter cleanup/exit callbacks cannot disconnect or terminate the replacement. Transport loss invalidates observers and leases. Run reload moved behind the coordinator without changing LOAD_ROM versus SET_MEM policies. Process monitoring has one identity-checked implementation; no automatic mutation replay/reconnect is introduced. The compatibility state enum and existing command/view IDs remain stable. Broad breakpoint/execution policy extraction remains R14; program image normalization remains R18.

Verification: 700 unit tests with zero skips, 62 regressions, seven minimum-version Extension Host/emulator tests, seven packaged current-version tests and three live conformance tests, including real borrowed attach/detach/reconnect. Host/browser-shared/full test compilation pass; CI passes with zero lint errors and the existing 66 warnings. New tests cover borrowed ownership, failed/delayed negotiation, stale leases/process exits, superseded launch and transport loss. Existing stop persistence, hover/value and stepping regressions remain green.

Stage 6 commit: `b4c9eaf` — `Coordinate owned and borrowed emulator sessions with scoped leases`.

## Implementation progress — stage 7 (R11)

Added one bounded artifact repository keyed by canonical ELF/executable identity and SHA-256 fingerprints of the exact captured byte snapshots decoded/validated. Concurrent loads coalesce; repeated unchanged versions reuse parsing; force/invalidate prevents stale in-flight reads from repopulating the cache. Defaults bound each disk input to 64 MiB and retained versions to eight entries. Same-path/same-size/same-mtime rebuilds are detected. DAP and symbol selections share the repository; standalone loader remains for fixture/compatibility callers.

Active-project resolution publishes relevant settings/selection changes and rejects older resolution results. Each panel/language/hover consumer has an independent selection with removable project subscriptions; clearing/failing one selection cannot clear another or the repository. Project changes prompt visible panels to synchronize; explicit Hex Viewer/Performance refresh also reloads symbols. Stable artifact versions retain symbol IDs. Query arrays/records are frozen; semantic query views block mutation and return defensive Buffer copies while private lazy parser caches remain usable. Language requests fork a selection to avoid concurrent-project lookup crossover. Definition-scan caching is bounded and keyed by artifact/source revision, invalidated by editor change/close notifications rather than cleared on every load.

Verification: 710 unit tests, zero skips; 62 regressions; seven minimum-version Extension Host/emulator tests; seven packaged current-version tests; three live conformance tests. Host/browser-shared/full test compilation, focused compiled repository/project/session/language tests and CI pass. Lint retains zero errors and the existing 66 warnings. Tests cover content/executable changes, same-mtime rebuilds, coalescing, force/eviction, retained immutable handles, failed/cleared/older loads, project notifications and source-edit invalidation. Existing ASM hover/value/struct-pool and C stepping behavior remains green.

Limitations: content checks read/hash inputs on each requested load for correctness, not speculative performance; cache size bounds retained versions, not a strict heap-byte budget. External filesystem edits are observed on reload (no background watcher introduced); editor source changes invalidate definitions immediately. Missing executable validation retains the standalone loader's existing behavior. No automatic reinterpretation of a running session's old metadata as a newly built ROM is attempted; a debug launch obtains a versioned handle for its load. Full artifact/build event coordination can extend this foundation without reintroducing global mutable selection.

Follow-up cleanup: removed the temporary EmulatorLifecycle import/name shim after R11. Production and tests now refer directly to SessionCoordinator; related types come from their real owner. No runtime behavior changes. CI passes with 710 unit tests, 62 regressions and the existing 66 lint warnings; full test typecheck passes. Historical audit references below remain as evidence of the original snapshot.

## Implementation progress — stage 8 (R12)

One checked memory backend now owns global address/bank/range/capability checks, chunking, response envelopes, echoed addresses, exact byte lengths and lossless byte decoding. Live MemoryService and stopped CPU reader use that boundary with separate caches/lifetimes, priorities and consumer budgets. Invalid array bytes are rejected instead of coerced. Live reads publish cache changes only after all chunks validate. Stop generation and connection scopes guard submission/dispatch/completion; stopped evaluation still degrades an unreadable variable rather than aborting a whole stop. CPU reads no longer silently mask out-of-range addresses.

Hex Viewer and watchpoint preview derive support from one documented protocol-v2 GET_MEM profile; preview's 16-byte display budget is not represented as a server capability. No IPC schema fields are invented. The stopped reader keeps a 256-byte evaluation budget independent of the backend chunk maximum. Production DAP supplies negotiated command availability and a stopped-generation guard.

Verification: 715 unit tests, zero skips; 62 regressions; seven minimum-version Extension Host/emulator tests and three live conformance tests. CI, host/browser-shared and full test typechecks pass with zero lint errors and the existing 66 warnings. Shared malformed envelope/address/length/byte vectors, capability/bank bounds, atomic cache publication and reconnect/stop invalidation tests pass. Existing live unwind/typed values, hover/struct pools and stepping remain green.

Stage 8 commit: `7e31a70` — `Validate memory exchanges through one scoped backend`. The preceding shim cleanup is `b90dece` — `Remove temporary emulator lifecycle compatibility shim`.

## Implementation progress — stage 9 (R13)

Moved typed values, formatting/scalar semantics, bounded C expression parsing/evaluation, symbol fallback and evaluation-context identifiers into the value domain. ValueReader owns DWARF locations, bounded typed memory reads and named children. ValueEvaluationService resolves typed variables before registers and ELF fallback, substitutes known assembler constants, resolves cast types and guards stale evaluation contexts. Watch/Console/native and language-owned hover use this single API. DAP projection/child counts/handles remain in the adapter; editor Markdown/navigation remains in its provider. Language/value import checks prohibit dependencies on DAP helpers. All imports were migrated directly; no compatibility re-export modules were introduced.

Validation exposed an intermittent C scope failure under overlapping stack requests. Deterministic regressions demonstrate duplicate asynchronous captures resetting the same generation's handles, and stale unwind results republishing after clear. Stack captures now coalesce per stop/context and reject invalidated completion. This focused correctness fix does not claim completion of R14's broader execution/breakpoint extraction.

Verification: 722 unit tests, zero skips; 62 regressions; 28 focused compiled tests; seven packaged current-version and seven packaged minimum-version Extension Host/emulator tests; three live conformance tests. CI and host/browser-shared/full test compilation pass; lint retains the existing 66 warnings with zero errors. Direct domain API tests cover presenter-independent results, signed values, resolution precedence, ELF constant/function/memory distinctions, stale reads and bounded children; existing hover/Watch/Console/Globals/struct-pool and C stepping parity remains green.

No UI layout, commands or IPC schemas changed. Full C mixed signed/unsigned promotion remains deferred as previously documented; hover timeout still discards late read-only results rather than cancelling backend work. Value byte/child budgets remain explicit; no shared mutable stop/live cache is introduced.

## Implementation progress — stage 10 (R14)

BreakpointCoordinator owns source/instruction reconciliation, configuration parsing, shared-address conflicts, IDs, server observations, logpoint expansion and temporary breakpoint references. Operations serialize against captured session identity and guarded wire dispatch. Failed replacement acknowledgments preserve the last acknowledged configuration; failed removals remain owned for retry. Partial source-step acquisitions are tracked immediately for cleanup. ExecutionController owns acknowledged run/pause/instruction-step/reset/restart/reload/logpoint sequencing; StopMonitor owns non-overlapping polling, sequence deduplication, manual-pause fallback and invalidation of delayed replies. Failed RUN no longer publishes a false continued/running transition.

DAP request arguments and outgoing envelopes are typed instead of per-handler any envelopes; malformed outer requests are rejected and unexpected dispatch failures receive error responses. Presentation/semantic source-step planning remains in the adapter, using the existing bounded planner rather than rewriting it. Narrow display/watchpoint-feedback ports replace all four legacy core-to-panel exceptions. No new runtime VS Code dependency is introduced in policy owners. Existing command IDs and IPC schema are unchanged.

Verification: 730 unit tests, zero skips; 62 regressions; seven minimum-version and seven packaged current-version Extension Host/emulator tests; three live conformance tests. CI and host/browser-shared/full test typechecks pass. Lint warnings drop from 66 to 26 (zero errors) by replacing untyped breakpoint/request envelopes. Direct policy regressions cover rejected configuration publication, shared source/instruction/temporary ownership, stale queued/in-flight edits, failed RUN, reset/reload order, stale controls and delayed polling. Existing C breakpoint/inline stepping and ASM hover/Watch/Globals/struct-pool tests pass.

Limitations: the facade types describe the supported DAP subset, not an imported third-party protocol library or exhaustive runtime schema validator. Data-watchpoint CRUD remains delegated to WatchpointService. Source location selection and editor decoration presentation remain in the adapter; broader project/program/navigation consolidation remains R18. Controls reject stale session work but do not replay mutations or cancel already-sent emulator commands.

**Next stage:** R15 broader checked browser build/migration. R16-R24 remain separate roadmap work.

## 1. Executive assessment

The project is a workable modular monolith with several good domain boundaries, not an irreparably tangled codebase. Its greatest weakness is **behavioral duplication and distributed ownership of state**, rather than a large graph of cyclic imports. New features repeatedly implement session synchronization, queues, capability gates, polling, error translation, panel scaffolding, menu interaction, validation, and formatting. Small variations in those implementations make otherwise similar features behave differently and increase the cost of correctness fixes.

The highest-leverage direction is:

1. Stabilize transport/session correctness and characterize existing behavior.
2. Extract small, explicitly owned primitives for repeated infrastructure.
3. Make one application service responsible for each operation; adapt it to editor, DAP, command, and webview surfaces.
4. Make the debugger adapter a protocol facade instead of the place where most debugging policy lives.
5. Share browser-safe logic and UI primitives across panels, while keeping feature-specific workflows explicit.
6. Enforce boundaries and behavior through executable tests and lightweight architectural checks.

**Do not** undertake a rewrite, introduce a dependency-injection container, adopt a UI framework merely to eliminate repetition, or build a universal CRUD service/panel base class. The current TypeScript, Mocha, VS Code APIs, and plain browser modules can support the proposed incremental work.

### 1.1 Current quality by dimension

| Dimension | Assessment | Practical implication |
|---|---|---|
| Feature organization | Generally good | Feature services/codecs already provide useful migration seams. Preserve them. |
| Responsibility separation | Uneven | Pure helpers are good; the DAP adapter, panel controllers, lifecycle, and activation contain multiple responsibilities. |
| Static dependency cycles | Low | No emitted CommonJS cycle found; this does not eliminate state coupling. |
| Dependency inversion | Weak in key areas | Services commonly require concrete lifecycle/client classes; debugger code directly knows panels. |
| Reuse | Improving, still inconsistent | Recent value/language extractions are positive, but substantial host/browser and service infrastructure remains duplicated. |
| State/concurrency model | Highest risk | Several unrelated generation counters, queues, lifecycle states, and visibility checks must agree informally. |
| Type safety | Good compiler baseline, weak boundaries | `strict` is enabled, but DAP `any`, asserted IPC results, and excluded browser scripts leave gaps. |
| Testing | Broad but uneven | Pure logic has useful tests; source-string assertions and private-state setup weaken refactoring confidence. |
| Operational diagnostics | Inconsistent | Errors may be swallowed, flattened to strings, posted in-panel, or surfaced as notifications. |
| Packaging/compatibility | Established workflow, incomplete gates | Packaged tests exist, but standard CI omits them and the declared VS Code floor is not exercised. |

## 2. Audit method, evidence, and limitations

### 2.1 What was examined

- Source/module inventory and file size distribution.
- TypeScript AST import/export graph, incoming/outgoing dependencies, and strongly connected components.
- Emitted CommonJS imports, to distinguish type relationships from runtime cycles.
- Exact function/method bodies after whitespace normalization; repeated browser CSS rules; manual review of near-duplicate workflows.
- Representative implementations across every major subsystem, including lifecycle, transport, services, panels, query/expression parsing, metadata, project persistence, and test harnesses.
- Existing design plans and documentation, so proposed work builds on rather than contradicts prior extractions.
- Compilation, unit/regression tests, lint, and targeted read-only runtime probes.

This audit includes the **existing uncommitted hover/value/Variables refactor**. In this snapshot, typed reading/formatting and the scope-versus-value handle namespace have already been consolidated. Recommendations below explicitly distinguish that improvement from remaining problems. This audit does not change those implementation files.

### 2.2 Measured snapshot

Counts include blank/comment lines and are approximate indicators, not quality scores or refactoring quotas.

| Measurement | Observed |
|---|---:|
| Production TypeScript files, excluding the source integration-test tree | 124 |
| Production TypeScript lines | About 19,200 |
| Debug TypeScript files / lines | 78 / about 13,672 |
| Emulator TypeScript files / lines | 20 / about 3,333 |
| Browser JS / CSS files under source | 10 / 10 |
| Direct production imports of `vscode` | 34 modules |
| Unit + regression test files | 94 |
| Test files containing `as any` | 42; heuristic, not a test-quality verdict |
| Test files reading files synchronously | 17; includes legitimate fixtures as well as source inspections |
| Exact normalized cross-file function/method-body groups over 90 characters | 22; not a semantic clone percentage |

Large responsibility clusters:

- `C:\Work\Programming\v6vscode\src\debug\adapter\v6-debug-adapter.ts`: 2,232 lines, 30 local import declarations.
- `C:\Work\Programming\v6vscode\src\debug\views\hex-viewer-provider.ts`: 546 lines, 14 local imports.
- `C:\Work\Programming\v6vscode\src\debug\views\trace-log-panel.ts`: 458 lines, 12 local imports.
- `C:\Work\Programming\v6vscode\src\emulator\lifecycle\emulator-lifecycle.ts`: 457 lines.
- `C:\Work\Programming\v6vscode\src\emulator\panel\emulator-panel.ts`: 409 lines.
- `C:\Work\Programming\v6vscode\src\extension.ts`: 403 lines, 45 local imports. High fan-out is expected in a composition root; embedded behavior is the concern, not the count itself.

Most imported local modules, counting source import declarations including type relationships: IPC commands 26, logger 25, concrete lifecycle 23, debug protocol models 21, concrete IPC client 19. Shared model fan-in is normal. Concrete orchestration/transport fan-in deserves narrower interfaces.

The source import graph contains one two-module component between `C:\Work\Programming\v6vscode\src\emulator\panel\emulator-viewmodel.ts` and `C:\Work\Programming\v6vscode\src\emulator\panel\script-overlay-renderer.ts`. The reverse relationship is a display-mode type; transpilation removes it. **No emitted CommonJS cycles were found.** Use explicit type-only imports or a small display-model module, but do not mislabel this as a demonstrated runtime cycle.

### 2.3 Validation baseline

Freshly run during this audit:

- `npm run compile`: passes.
- `npm run test:unit -- --reporter dot`: 568 passing, 26 pending.
- `npm run test:regression -- --reporter dot`: 62 passing.
- `npm run lint`: no errors, 66 warnings.
- Mocha JSON results confirm all 26 pending cases belong to optional demo-artifact suites in `C:\Work\Programming\v6vscode\test\unit\debug\elf-dwarf.test.ts`; they are not all failing C-metadata tests.

The immediately preceding fix also passed six Extension Host/real-emulator integration tests. That result is useful existing evidence, but those integration tests were **not rerun for this documentation-only audit**. Test counts do not establish comprehensive behavior, performance, security, platform, or minimum-version coverage.

### 2.4 Confidence labels

- **Observed:** directly visible in inspected code or measured by the dependency/duplication scan.
- **Reproduced:** demonstrated by a small isolated probe; not necessarily an end-to-end user reproduction.
- **Risk:** plausible consequence that needs a focused regression test or profiling before declaring a defect.

The audit is broad architectural analysis, not a full security review, formal proof, or exhaustive semantic review of every parser operation. No whole-repository clone ratio, coverage percentage, or runtime latency claim is inferred from static scans.

## 3. Strengths to preserve

1. **Explicit composition instead of a service locator.** Constructors and activation show dependencies directly.
2. **Single shared launch transport.** Debug launches and display use the prioritized IPC client; do not reintroduce separate sockets for panels on a single-client server.
3. **Feature services separate from browser DOM.** Scripts, watchpoints, performance, memory edits, ports, and statistics have service boundaries and pure validation modules.
4. **Server authority is usually respected.** Several services validate responses and reconcile snapshots rather than treating optimistic browser state as truth.
5. **Pure language presentation.** The shared source-line, highlighting, and symbol-link services can support multiple consumers without emitting consumer-specific HTML.
6. **Useful debugger extractions.** Stack traces, locations, source-step decisions, temporary breakpoints, variable reads, and typed formatting already have dedicated modules.
7. **Honest degraded behavior.** Missing unwind/location metadata generally produces an unavailable value or honest frame boundary, not fabricated callers.
8. **Safe browser rendering patterns.** The reviewed table/list scripts mostly use `textContent`; nonce-based script CSPs are widespread.
9. **Real protocol and emulator tests exist.** Preserve these alongside faster isolated tests.
10. **Small dependency set.** Most proposed changes need no new runtime dependency.

## 4. Architectural issues and impact

### A1. Transport ordering is not safe after a timeout or connection failure — P0

**Evidence:** `C:\Work\Programming\v6vscode\src\emulator\client\ipc-client.ts`, especially `executeWrite`, `rejectPending`, `processNextInQueue`, and socket close handling; framing in `C:\Work\Programming\v6vscode\src\emulator\protocol\ipc-codec.ts`.

The wire protocol is sequential and responses carry no client request identity. On timeout, `rejectPending` starts the next queued request without abandoning the connection. An isolated fake-socket probe timed out request A, left B pending, then supplied A's late framed response; B received that response. Socket close/disconnect handling also invokes the same queue-advancing method before all work is drained.

**Impact:** wrong-response attribution can corrupt any feature's apparent data, cause misleading decode errors, and defeat higher-level generation checks. This is more urgent than removing formatting duplication.

**Plan:** define one terminal failure transition that detaches the socket, clears buffers, rejects the active request and every queued request, and never advances the failed stream. Without a protocol correlation ID, a timed-out stream must not simply continue. Coalesce concurrent connection attempts. Bound frame sizes, receive buffering, and queue growth. Separate queue-wait deadline from on-wire timeout. Document that an already-issued request cannot be safely preempted just because a critical request arrived.

**Acceptance:** delayed A cannot satisfy B; timeout/remote close/disconnect reject all pending work once; no writes occur on a failed socket; reconnect uses a new epoch. Test with fragmented, coalesced, truncated, and oversized frames.

### A2. Session ownership and execution state are distributed — P1

**Evidence:** `C:\Work\Programming\v6vscode\src\emulator\lifecycle\emulator-lifecycle.ts`, `C:\Work\Programming\v6vscode\src\debug\adapter\v6-debug-adapter.ts`, and feature service `stateChange` listeners.

Lifecycle tracks process/socket ownership and `stopped/launching/connected/running`; the adapter separately tracks `idle/running/paused/disconnected`, pending control flags, stop records, metadata, and generations. Display view-model state adds another representation. Many observers infer pause from `connected && !running`, which can also describe handshake/configuration stages.

Run and debug startup differ materially: run uses a fixed port and inline process monitoring; debug uses a free port and identity-guarded `monitorProcess`. Attach creates its own client in the adapter and bypasses the shared lifecycle/services. These modes have legitimate differences, but duplicate orchestration is not a good way to express them.

**Impact:** stale exits may affect newer run sessions; features may synchronize before negotiation finishes; attach and launch expose different tool availability; teardown and persistence depend on entry point.

**Plan:** introduce a narrow session context and coordinator with explicit connection phase, execution state, ownership, immutable capability snapshot, connection epoch, and stopped-generation token. Keep launch/attach and ownership policies explicit. Publish a ready session only after negotiation. Add identity checks to all process completion paths. Reject or explicitly coordinate concurrent debug sessions rather than merely storing multiple adapters around one lifecycle.

### A3. The DAP adapter is an application controller, not just a protocol adapter — P1

**Evidence:** `C:\Work\Programming\v6vscode\src\debug\adapter\v6-debug-adapter.ts` handles launch/attach, execution, polling, stop interpretation, breakpoint parsing/reconciliation, source stepping, metadata, values, DAP construction, source decoration, data breakpoints, and cleanup. Its factory directly injects display and watchpoint panel classes.

**Impact:** changes require understanding many unrelated state variables; test setup reaches into private members; request `any` types hide invalid combinations; headless/debugger reuse is difficult.

**Plan:** extract along already visible responsibility seams, not arbitrary line ranges:

- `DebugSessionController`: lifecycle ownership and session transitions.
- `ExecutionController`/`StopMonitor`: run/pause/step commands and authoritative/legacy stop interpretation.
- `BreakpointCoordinator`: one ownership/reconciliation model for source, instruction, log, and temporary step breakpoints; data watchpoint operations remain a specialized service.
- `ValueEvaluationService`: selected/default frame, DWARF resolution, registers, symbol fallback, and resource budgets; retain existing reader/formatter.
- `DebugArtifactRepository` and stopped-context provider: immutable metadata and per-stop state.
- VS Code-specific decoration/navigation presenter: editor effects, not debugger policy.
- Typed DAP request/response mapping at the outer boundary.

Keep one mutation/control ordering policy; do not serialize all reads behind long-running operations indiscriminately. Feature services emit typed events or return results; they must not call concrete panels to refresh them.

### A4. Async validity is repeated and incomplete — P0/P1

**Evidence:** each service implements its own `generation`, queue, refresh-in-flight, and reset rules. Many mutations validate session availability **when the queued callback starts**, not against the session in which the user submitted it. Several panel `syncSession` methods await work and then post ready state without a common panel/session token.

**Risk:** an old queued action can execute against a newly connected emulator; old success/failure messages can update a recreated webview; hiding a panel can stop a timer without invalidating in-flight work.

**Plan:** capture operation context at submission: connection epoch, optional stop epoch, feature revision, and optional panel-instance token. Validate before execution, before every subsequent mutation after an await, and before publish. Refresh coalescing must be keyed by scope. Cancellation must remove unsent work or discard stale results; do not confuse a UI timeout with cancellation of backend work.

Not all epochs mean the same thing. Trace filters, overlay removals, stopped frames, connection replacements, and panel recreation need distinct typed tokens rather than one universal integer.

### A5. DAP handle namespace has improved, but wire identity still needs hardening — P1

**Evidence:** the current adapter now uses one variables-reference store, fixing the prior scope/value collision. However, `C:\Work\Programming\v6vscode\src\debug\adapter\dap-handle-store.ts` resets `nextHandle` to 1 on each generation.

**Reproduced:** allocate handle 1 in generation A, reset to B, allocate a new handle, then resolve wire reference 1 in B: it returns B's new value. DAP `variables` requests carry only the integer reference, so the store's generation argument cannot identify the origin of an old wire reference after reuse.

**Plan:** do not reuse exposed handle IDs within an adapter lifetime, or encode generation safely in the allocated handle space; clear stored values at invalidation and return an explicit stale/unknown result. Keep frame identity and variables-reference rules documented separately. Add delayed cross-stop request tests, beyond same-generation scope/pool tests.

### A6. Shared symbols have many writers and a path-only cache — P1

**Evidence:** `C:\Work\Programming\v6vscode\src\debug\metadata\debug-symbol-service.ts` caches by artifact path; the adapter separately loads artifacts. Hex Viewer, Watchpoints, Performance, Symbols, and language resolution can load/clear the shared symbol service. `C:\Work\Programming\v6vscode\src\language\symbols\symbol-link-service.ts` clears definition scan cache on every load call.

**Impact:** same-path rebuilds can retain stale symbols; consumer failures can clear metadata used by other views; multiple loads repeat parsing; repeated definition scans/open-document requests can make large trace/hover workloads expensive. These are ownership/cache-validity problems, not reasons to make every view maintain its own copy.

**Plan:** one artifact repository keyed by normalized ELF + executable identity and file version/fingerprint, with in-flight coalescing, explicit invalidation, bounded storage, and a forced reload path. An active-project/session context selects immutable handles; panels consume read-only query interfaces and cannot clear global metadata. Cache source definitions against artifact generation plus source-document version. Preserve baseline line/symbol access when optional semantic parsing is unsupported, with structured diagnostics.

### A7. Memory reads share a command but not a contract — P1

**Evidence:** `C:\Work\Programming\v6vscode\src\emulator\memory\memory-service.ts` handles banked cached reads, capability-based chunking, returned address validation, and epochs. `C:\Work\Programming\v6vscode\src\debug\metadata\stop-memory-reader.ts` separately sends `GET_MEM`, hardcodes a 256-byte bound, and checks length but not the returned address. Watchpoints constructs another MemoryService and hardcodes preview capability values in `C:\Work\Programming\v6vscode\src\debug\views\watchpoints-provider.ts`.

**Impact:** capability assumptions and malformed-response behavior vary; one memory consumer can accept a response another rejects; extending bank or range support requires several changes.

**Plan:** share a validated memory transport/repository interface. Layer a stopped CPU-address reader and a visible banked cache on it. Do **not** share mutable live-view cache validity with a stopped debugger snapshot. Make CPU address, bank offset, global address, and inclusive range distinct types/policies. Keep preview limits and read budgets as consumer policies, not fictional capabilities.

### A8. Composition root contains behavior and runtime method replacement — P1

**Evidence:** `C:\Work\Programming\v6vscode\src\extension.ts` repeats panel/context/command setup and replaces `lifecycle.stop` to run FDD persistence. `deactivate` relies on the synchronous disposable graph. Lifecycle/client ownership is not represented by one explicit asynchronous shutdown object.

**Impact:** cleanup order and persistence behavior are implicit; direct lifecycle consumers cannot see the injected stop behavior; some resources are managed indirectly through panels.

**Plan:** replace monkey-patching with a stop coordinator or explicit awaited stop participants, including policy for persistence failure and idempotent concurrent stop. Register a session disposer with ownership-aware cleanup; return an awaited shutdown promise from deactivation where appropriate. Use explicit feature registration functions and a small panel registry for open-state/context/commands. Preserve a readable composition root rather than hiding dependencies in a service locator.

### A9. Presentation and domain modules depend in the wrong direction — P1/P2

**Observed examples:**

- The DAP adapter/factory import concrete `WatchpointsProvider` and `EmulatorPanel`.
- Hex Viewer is a concrete dependency of Symbols, Watchpoints, and Memory Edits.
- Language hover imports shared value formatting and evaluation context from the debugger **adapter** folder.
- Stopped memory/network evaluation lives under metadata; immutable parsing, runtime observation, and transport are mixed.
- Protocol handshake fetching and pure capability validation are in the same module.
- The project model imports VS Code URI types; Logger is a VS Code-backed concrete dependency across core services.

**Plan:** define small ports at the consumer boundary: session observation, emulator commands, memory reads, artifact queries, source navigation, Hex Viewer navigation, project selection, logging, and clock/scheduling. Move shared typed-value logic out of the DAP adapter boundary without creating a miscellaneous global utility bucket. Use `import type` for type relationships; do not create one interface per class without a concrete testing or dependency benefit.

### A10. Browser modules are a parallel, weakly checked implementation — P1/P2

**Evidence:** browser asset folders are excluded in both `C:\Work\Programming\v6vscode\tsconfig.json` and `C:\Work\Programming\v6vscode\tsconfig.test.json`; lint targets TypeScript only. `// @ts-check` comments therefore do not make the main build validate these scripts. Browser scripts duplicate parsing, filtering, address mapping, menu behavior, drafts, and generation handling.

**Impact:** host unit tests can pass while browser behavior differs; message unions do not protect runtime input; fixes must be manually ported across execution environments.

**Plan:** compile/check browser code with a separate DOM-aware configuration. Use shared pure browser-safe modules and shared message contracts with no Node/VS Code runtime imports. Native ES modules or existing `tsc` output are viable first steps; select bundling only if packaging/import needs justify it. Keep host-side validation authoritative even when browser validation uses the same primitives.

### A11. Typed formatting is not enough: numeric semantics need one owner — P0/P1

**Evidence:** shared formatting now handles signed display, but `fromTypedValue`/`typedScalar` in `C:\Work\Programming\v6vscode\src\debug\adapter\c-expression-service.ts` decode raw bytes as unsigned. An isolated evaluation of `x < 0` for a two-byte signed `x = -1` returned false.

**Impact:** a value can look correct in Watch and still behave incorrectly in an expression. Additional risks include untyped immediate width, enum signedness, alias handling, arithmetic conversions, and unsupported widths.

**Plan:** separate raw decode, typed scalar interpretation, expression arithmetic, and UI formatting while sharing type/width policy. Prefer DWARF encoding over spelling heuristics for signedness. Define target arithmetic, promotion/overflow, and unsupported-width behavior. Reuse the same typed semantic operations in expression evaluation and summary formatting; do not fix comparisons by adding surface-specific patches.

## 5. Dependency and module structure analysis

### 5.1 Current conceptual graph

```text
VS Code activation
  -> concrete feature panels + commands + project services
  -> shared lifecycle + shared IPC client
  -> debugger adapter -> feature services AND concrete panels
  -> language providers -> language services -> debug metadata
                       -> debugger adapter helpers (current value refactor)

Panels -> feature services -> concrete lifecycle + IPC -> emulator
Panels -> other concrete panels (navigation)
Panels -> shared mutable symbol service (load/clear/query)
Metadata -> immutable binary parsers, plus stopped context/network readers
Browser JS -> manually mirrored messages + local parsing/filtering/UI state
```

A mostly acyclic graph can still be tightly coupled through shared mutable services, ambient VS Code APIs, string events, state listeners, and request ordering. The lack of runtime cycles is a strength, not evidence that these responsibilities are sufficiently separated.

### 5.2 Proposed logical boundaries

Proposed locations below are illustrative. Preserve public facades while migrating; do not move all files before changing ownership.

| Boundary | Responsibilities | Allowed dependencies | Must not depend on |
|---|---|---|---|
| `C:\Work\Programming\v6vscode\src\shared` | Browser-safe numbers, ranges, result/error DTOs, genuinely common models | Standard language types | VS Code, Node transport, panels, DAP |
| `C:\Work\Programming\v6vscode\src\platform` | Small logging/clock/file/disposal ports and host adapters | Host APIs inside adapters | Debug feature policy |
| `C:\Work\Programming\v6vscode\src\emulator\protocol` | Wire DTOs, framing, primitive payload decoding, capability contracts | Shared pure types | Concrete lifecycle, views |
| `C:\Work\Programming\v6vscode\src\emulator\session` | Connection identity, capabilities, ownership, process and program-load coordination | Transport/launcher ports | Concrete panels or editor widgets |
| `C:\Work\Programming\v6vscode\src\debug\metadata` | ELF/DWARF parsing and immutable query models | Binary reader primitives | Live IPC and UI |
| `C:\Work\Programming\v6vscode\src\debug\values` | Typed value semantics, evaluation, summaries, read budgets | Metadata interfaces, memory/frame ports | DAP or browser UI |
| Feature service folders | Scripts/performance/watchpoint/etc. policy and server reconciliation | Narrow session/command ports, codecs | VS Code widgets, concrete sibling panels |
| `C:\Work\Programming\v6vscode\src\debug\adapter` | Typed DAP mapping and request dispatch | Debug application services | Webview implementations |
| `C:\Work\Programming\v6vscode\src\language` | Lexical/presentation/source-link operations | Read-only source/symbol ports | Consumer panels; DAP request machinery |
| Host UI adapters | Commands, confirmation, clipboard, navigation, webview orchestration | Application services and host APIs | Ownership of shared session/artifact state |
| `C:\Work\Programming\v6vscode\src\webview` | Checked browser primitives and feature entry points | Browser-safe shared contracts | Node, `vscode`, emulator sockets |

Application services should return domain results, not Markdown, HTML, or DAP fields. DAP child counts/handles stay in the DAP presenter; type-aware value/aggregate semantics stay in the value domain. Host webview view models remain explicit projections of acknowledged service snapshots.

### 5.3 Enforcement

- Add a checked import-boundary test using the existing TypeScript compiler API; distinguish type-only and emitted edges.
- Prohibit new core-to-view imports and `vscode` runtime imports in pure codecs/metadata/value/shared modules.
- Allow explicit, documented infrastructure exceptions instead of a complex rule engine.
- Avoid root barrels that re-export both pure models and VS Code adapters, causing consumers to import side effects accidentally.
- Keep feature models/contracts near their owner; split broad protocol model files by domain if navigation or change coupling warrants it, while retaining a compatibility export facade temporarily.
- Treat high fan-in to stable pure types as desirable. Target concrete orchestration dependencies and change coupling, not raw import count reduction.

## 6. Code duplication hotspots and extraction decisions

Exact-body counts below are lower bounds, not a semantic clone ratio. Share algorithms and infrastructure, not superficially similar domain workflows.

### D1. Queues and refresh coalescing — P1

Identical `enqueue` bodies occur in:

- `C:\Work\Programming\v6vscode\src\debug\memory-edits\memory-edit-service.ts`.
- `C:\Work\Programming\v6vscode\src\debug\performance\performance-service.ts`.
- `C:\Work\Programming\v6vscode\src\debug\scripts\script-service.ts`.
- `C:\Work\Programming\v6vscode\src\debug\scripts\script-overlay-service.ts`.
- `C:\Work\Programming\v6vscode\src\debug\watchpoints\watchpoint-service.ts`.

Hardware statistics has a similar mutation chain; refresh-in-flight cleanup is repeated too.

**Extract:** composed `SerialTaskQueue` and keyed `SingleFlight`, with scope validity, disposal, and deterministic scheduling. A service queue preserves a multi-command transaction; the IPC queue orders individual wire exchanges. Both are needed. Keep acknowledgement checks, revisions, reconciliation and running-state policy feature-specific. Pilot two services before generalizing.

### D2. Primitive payload validation — P1

Identical `object`, bounded `integer`, and `boolean` helpers occur in:

- `C:\Work\Programming\v6vscode\src\debug\memory-edits\memory-edit-codec.ts`.
- `C:\Work\Programming\v6vscode\src\debug\performance\performance-codec.ts`.
- `C:\Work\Programming\v6vscode\src\debug\scripts\script-codec.ts`.
- `C:\Work\Programming\v6vscode\src\debug\scripts\script-overlay-codec.ts`.

Three also share identical UTF-8 string validation. Watchpoint/trace/statistics helpers have near-clones.

**Extract:** record, bounded integer, boolean, UTF-8 byte length, exact-field and array primitives with structured field-path errors. Keep domain schemas, union invariants, uniqueness, and acknowledgement validation local. Distinguish user input errors from malformed server data. Browser-safe byte-length logic must not import Node-only codecs.

### D3. IPC results and errors — P1

Identical `responseData` bodies occur in Memory Edits, Performance, Scripts and Watchpoints services. Separate `protocolError` functions retain different subsets of server code, field and reason; some lifecycle/command sends ignore `ok`.

**Extract:** checked response envelopes and `ProtocolError` preserving command, code, details, retryability and cause. Feature policies may add capacity/id-exhaustion guidance without flattening fields. UI presenters select notification or inline display. Add a command/result type map incrementally, but retain runtime decoding: `send<T>` alone does not validate wire data.

### D4. Webview host shell and lifecycle — P1/P2

Memory Edits, Performance, Scripts, Watchpoints, Symbols, Ports, Hex Viewer, Trace Log and hardware statistics repeat nonce/resource/CSP setup and open/visibility/dispose state. Representative files:

- `C:\Work\Programming\v6vscode\src\debug\views\memory-edits-panel.ts`.
- `C:\Work\Programming\v6vscode\src\debug\views\performance-panel.ts`.
- `C:\Work\Programming\v6vscode\src\debug\views\scripts-panel.ts`.
- `C:\Work\Programming\v6vscode\src\debug\views\ports-provider.ts`.

**Extract by composition:** document builder for nonce/CSP/resource tags and escaped titles; panel host for ready/dispose/visibility, panel identity and disposables; typed message bridge; small panel registry. Keep feature markup/actions/snapshots local. Sidebar views and the display canvas reuse shell/security primitives without inheriting a table controller. Avoid a many-hook `BasePanel` hierarchy.

### D5. Browser table/edit/menu state and CSS — P2

`C:\Work\Programming\v6vscode\src\debug\views\assets\memory-edits.js`, `C:\Work\Programming\v6vscode\src\debug\views\assets\performance.js`, and `C:\Work\Programming\v6vscode\src\debug\views\assets\scripts.js` repeat cells, selection, drafts, submitting state, focus restoration, invalid controls, snapshot handling and menus. Matching CSS shares exact theme, toolbar, selection, borders, menu and screen-reader rules.

Symbols implements Home/End menu keys while other menus implement different subsets: concrete interaction drift.

**Extract:** `ContextMenuController`, `QueryHistory`, validation/focus helpers, a small edit-state reducer, and common table theme CSS with feature variables. Keep domain row rendering local. Define keyboard opening, Escape, arrows/Home/End, disabled actions, focus return, outside click, hide and scroll once. Preserve `textContent`; do not replace safe DOM construction with unescaped HTML.

### D6. Tested host logic has separate browser implementations — P1/P2

- Wildcard script matching: `C:\Work\Programming\v6vscode\src\debug\views\scripts-query.ts` versus browser `matches` in `C:\Work\Programming\v6vscode\src\debug\views\assets\scripts.js`.
- Byte literals: `C:\Work\Programming\v6vscode\src\debug\views\memory-edits-query.ts`, `C:\Work\Programming\v6vscode\src\debug\hardware-statistics\hardware-statistics-format.ts`, and browser `parseByte`.
- Global-address labels: host memory-space helpers versus browser `addressTitle` and hardcoded bank arithmetic.

**Extract:** browser-safe pure modules, consume the same compiled algorithms in both environments, and migrate against shared test vectors. Host validation stays mandatory. Do not retain duplicate JS merely because the TS helper is easier to test.

### D7. Numeric parsing/formatting — P1/P2

Hex helpers recur in stack traces, values, Symbols, Performance, Trace Log, hardware/CPU statistics and browser scripts. Decimal/`$`/`0x`/`h` parsing recurs in query, palette, expression and browser paths.

**Extract:** numeric literal parsing plus explicit domain validation; hex formatting with clearly named digit-width or byte-width options. Define byte, CPU address, global address, color, offset and signed-value policies. Symbols intentionally displays an address while Watch may display that symbol's memory contents: share mechanics without erasing the distinction. Reject invalid ranges instead of silently wrapping unless a machine operation explicitly requires wrapping.

### D8. Expression parsing and evaluation — P1/P2

`C:\Work\Programming\v6vscode\src\debug\utilities\symbol-expression.ts` and `C:\Work\Programming\v6vscode\src\debug\adapter\c-expression-service.ts` implement separate parsers with overlapping arithmetic and numeric syntax. The C service also has scalar and typed AST walkers. The smaller parser lacks the C parser's input/token/depth budgets.

**Unify carefully:** share lexical primitives, numeric conversion, checked arithmetic and parse budgets first. Define explicit address-expression and typed-C dialects. A symbol in an address field means its address; a typed Watch variable may mean memory contents; a dotted ASM name and a C member path are not interchangeable. Preserve syntax and resolution precedence through compatibility vectors. One bounded AST with policy-driven evaluation may eventually replace both parsers, but should not be a prerequisite for small safe extractions. DWARF bytecode expressions are a different language and should remain separate.

### D9. Symbols, source navigation, identity and lexical masking — P1/P2

Repeated artifact load/clear workflows exist in Hex Viewer, Performance, Watchpoints and Symbols. Source navigation already has a useful shared implementation in `C:\Work\Programming\v6vscode\src\debug\views\debug-source-navigation.ts`; use a narrow navigation port rather than creating more helpers per view.

`codeBeforeComment` is an exact duplicate in `C:\Work\Programming\v6vscode\src\language\symbols\symbol-link-provider.ts` and `C:\Work\Programming\v6vscode\src\language\symbols\symbol-link-service.ts`. Extract a shared ASM lexical helper with string/comment tests, preserving character offsets. Reuse existing token services for token-at-position rather than rescanning the entire document on each hover once versioned caching is available.

Source identity also varies across index normalization, source-line/highlighter caches, navigation and breakpoint keys. Distinguish filesystem paths from URI identifiers and compiled-site remapping. Share canonical identity with explicit platform/case rules; do not apply filesystem `path.normalize` blindly to URI strings. Test Windows drive/UNC paths, POSIX paths, dirty documents and ambiguous source remapping.

### D10. ROM/FDD loading, settings and persistence — P1

Run hot reload in `C:\Work\Programming\v6vscode\src\commands\run-project-command.ts`, ordinary launch and debug loading/reload in `C:\Work\Programming\v6vscode\src\emulator\lifecycle\emulator-lifecycle.ts` repeat file reads, ROM/FDD classification, address parsing, request construction and logging. Settings are applied in lifecycle and again through `C:\Work\Programming\v6vscode\src\emulator\panel\emulator-settings-controller.ts`.

**Extract:** validated `ProgramImage`/load request preparation and `ProgramLoader`, with explicit autorun, initial-load versus byte-replacement, FDD boot, breakpoint preservation and read-only policies. Keep LOAD_ROM and debug SET_MEM semantics distinct where required. Consolidate display/speed normalization and checked settings application. Replace stop monkey-patching with the coordinator described in A8. Preserve dirty-disk confirmation/export behavior; storage work needs transactional/atomic writes where feasible.

### D11. Parallel DWARF parsing — P2, high regression risk

`C:\Work\Programming\v6vscode\src\debug\metadata\dwarf4-info-reader.ts` and `C:\Work\Programming\v6vscode\src\debug\metadata\dwarf-reader.ts` each decode abbreviations/forms/units. The artifact loader invokes legacy compilation-directory/declaration logic and the semantic graph separately.

**Plan:** share bounds-checked binary reading and a version-aware DIE/form layer; derive compilation directories, declarations, types and scopes as projections. Preserve baseline debugging when optional semantics fail. Differential tests across ASM v4, C v5, multiple units, relocation, unknown forms and truncated data must precede removal of either path. Do not merge the line-program state machine with DIE decoding just because both parse DWARF.

### D12. Configuration and contribution metadata — P2

Project shape/defaults are repeated across `C:\Work\Programming\v6vscode\config\schemas\v6.project.schema.json`, runtime validator/model, templates, settings and documentation. The JSON schema permits empty name/executable strings while runtime validation rejects them. Display mode/speed rules and command/view IDs are spread between contributions, constants and feature modules.

**Plan:** one normalized project settings model and tested defaults; schema/runtime parity vectors; explicit semantic validation for load addresses/speed. Separate project selection UI from loading/current immutable state and publish project-change events. Use a typed contribution/panel registry plus manifest contract tests; do not add complex generation for every string. Keep four small Makefile variants readable unless measured maintenance shows a shared generator is better.

## 7. Similar features that should share an execution path

| Operation | Current divergence | Target common path | Differences to preserve |
|---|---|---|---|
| Values in Watch, hover, Console, struct and pool rows | Recent refactor shares typed reader/formatter; frame resolution remains in adapter; raw scalar interpretation differs from display | Frame context -> typed evaluation -> domain value/summary -> surface presenter | Static address without a live session; instruction-aware register pairs; C versus ASM syntax; DAP expansion versus Markdown links |
| Address fields in Hex Viewer, Performance, Watchpoints and breakpoints | Overlapping expression/number parsing and independent range validation | Bounded address dialect -> symbol-address resolver -> domain-specific range validation | CPU versus global address; inclusive range; no accidental dereference |
| Reading CPU RAM and banked memory | Different response checks, capabilities, chunking, invalidation | Validated memory transport -> stopped-reader or live-cache adapter | Stop coherence, RAM-disk mappings, cache lifetimes, budgets and priority |
| Session launch, attach, run reload and debug reload | Different process/socket ownership and program setup | Session coordinator -> explicit mode policy -> ProgramLoader -> shared negotiation | Owned launch versus borrowed attach, autorun, breakpoint preservation and boot behavior |
| Refresh/mutation of server collections | Repeated queues, generations and response handling | Scoped operation/queue primitives -> feature mutation -> acknowledged snapshot/revision | Full reconciliation versus revision-aware mutation; consuming overlay deltas must have one reader |
| Opening/hiding/closing a tool | Repeated resource/CSP/visibility/disposal code | Panel registry -> panel host -> feature controller | Sidebar views, display readiness recovery and feature-specific persisted state |
| Source/Hex Viewer navigation | Direct concrete sibling-panel calls and repeated root/source resolution | Typed navigation ports -> registered host adapter | Exact definition versus nearest executable line; source remapping; bank-crossing rejection |
| Query history and menus | Similar browser state copied into several assets | Browser history/menu modules with tested interaction contract | Feature query grammar and enabled actions |
| Protocol errors -> field errors/status | Strings and regex field extraction vary per panel | Structured error -> feature view-model projection -> common operation UI | Feature wording; throttled notification versus inline correction |

### Reuse rule

One implementation per **semantic policy**, with multiple adapters if the runtime/surface differs. Browser feedback and authoritative host validation are separate responsibilities, but should share the same pure rules. Do not unify address lookup with value dereference, live caches with stopped snapshots, trace filters with collection revisions, or full snapshots with consuming deltas.

## 8. Shared utilities/services to introduce incrementally

Proposed API names are design contracts, not a request for a broad utility framework.

| Component | Owner | Contract and first consumers |
|---|---|---|
| Numeric literals / formatters | Browser-safe shared primitives | Parse complete literals, reject trailing junk/unsafe values, format with explicit width. Palette, Memory Edits, Hex Viewer and browser counterparts. |
| CPU/global address and ranges | Emulator domain models | Distinguish address spaces; validate inclusive range, overflow and bank boundaries. Hex navigation, watchpoints, breakpoint expressions and memory readers. |
| Payload validation | Protocol support | Primitive decoders and field-path errors; feature codecs retain schema composition. |
| Protocol result/error helpers | Transport/application boundary | Check `ok`, retain code/details/cause, decode `unknown` data. Migrate services before commands/lifecycle. |
| SerialTaskQueue / SingleFlight | Small async support module | Recovery after rejection, cancellation before dispatch, scoped operation identity, disposal. Do not replay stale mutations in a new connection. |
| SessionContext / SessionScope | Emulator session | Immutable identity/capabilities and typed observation; acquire/validate connection and stop tokens. Services use this rather than the full lifecycle class. |
| RefreshController | Host/application support | Single in-flight refresh, latest-request coalescing, visibility/pause policy, backoff and no post-dispose publish. A poll policy is explicit per feature. |
| DebugArtifactRepository | Metadata infrastructure | Versioned ELF/ROM identity, one parse/in-flight load, immutable query handles and diagnostics. Adapter, Symbols and language features. |
| MemoryReader / MemoryRepository | Emulator memory | Validated/chunked transport; stopped and banked-cache wrappers own coherence. |
| ValueEvaluationService | Debug values | Typed scalar semantics, frame resolution, symbol fallback and bounded reads; share with all value surfaces. |
| ProgramLoader / StopCoordinator | Emulator application | Shared file/request preparation, mode policies, awaited stop/persistence participants and idempotence. |
| WebviewDocument / PanelHost | VS Code host UI | CSP/assets/ready/visibility/disposal/panel token and checked message boundary; feature controllers remain concrete. |
| Browser menu/history/edit primitives | Browser-only UI | Actual compiled reusable code and behavior tests; table CSS tokens and accessible controls. |
| Navigation ports | Host application | Reveal source or memory range without concrete view imports. Existing source navigation is the implementation seed. |
| LogSink / Clock / Scheduler | Platform ports | Narrow interfaces, VS Code adapter and deterministic fakes. Reuse the clock-injection pattern already present in source stepping. |

### Operation identity invariants

1. Acquire a connection token **before** queueing an action, not only inside its callback.
2. Optionally bind to a stopped generation, feature revision or panel instance; never substitute one token kind for another.
3. Before dispatch, reject disposed/cancelled/stale work. After awaited reads, recheck before publishing. Between multi-step mutations, recheck before issuing the next command.
4. Rejected/expired operations leave the queue usable without authorizing them against a different session.
5. A protocol timeout invalidates the ordered transport stream; a hover deadline only abandons that presentation operation. Late work must not create fresh handles or publish stale data.
6. Exposed IDs must not alias unrelated objects across valid request lifetimes.

These invariants are more important than whether the helper is implemented as a class or a function.

## 9. Engineering improvements beyond duplication

### 9.1 Typed boundaries and diagnostics

- Accept DAP, IPC, persisted state and webview input as `unknown`; decode once at the boundary into discriminated unions. A TypeScript annotation on `onDidReceiveMessage` is not runtime validation.
- Add typed DAP command/request/response mapping without requiring a new package initially. Replace `any` incrementally around request dispatch, breakpoint configuration and Variables results.
- Carry field/code/reason through services to UI. Remove regex guesses such as `performanceErrorField` and Scripts `errorField` as structured errors migrate.
- Replace availability-by-exception in polling hot paths with an explicit capability assessment result, keeping useful unsupported reasons.
- Add a typed event contract or narrow subscribe APIs for session, service changes and overlay reconciliation. Many lifecycle listeners are legitimate; the raised listener limit is not proof of a leak. Still test listener counts across repeated open/close/start/stop.
- Make parser degradation visible in diagnostic snapshots instead of swallowing all optional-metadata failures without context. Continue graceful baseline debugging.
- Explicit `import type` improves architectural readability even where TypeScript already elides imports.

### 9.2 Debug metadata correctness and binary safety

Prioritize focused correctness tests before parser consolidation:

- `C:\Work\Programming\v6vscode\src\debug\metadata\dwarf-reader.ts` currently defines both `DW_FORM.block` and `DW_FORM.block1` as `0x09`. A probe confirms the alias; DWARF block1 is `0x0A`. Duplicate switch paths deserve a direct constant/form regression test.
- `C:\Work\Programming\v6vscode\src\debug\metadata\dwarf-types.ts` infers base signedness largely from names despite reading encodings; array bounds use low/high PC attributes instead of dedicated subrange bounds; unsupported member-location blocks fall back to zero. These are inspected correctness concerns, not newly verified failures in every real producer. Add encoding, array-bound and unsupported-member tests, then represent unsupported offsets explicitly rather than silently reading offset zero.
- Use bounds-checked cursor primitives for section headers, strings, LEB128, abbreviations, form reads and reference resolution. Bound recursion, DIE count, string length and allocation. Preserve 16-bit target assumptions explicitly.
- Separate immutable metadata projections from runtime stopped evaluation. Share resolved type utilities without making binary parsing depend on DAP or live IPC.
- Add fuzz-style deterministic malformed/truncated vectors with existing tooling; decide later whether a fuzzing library adds value.

### 9.3 Project/configuration and file effects

- Maintain one normalized, immutable active-project snapshot with change events. Selecting a project should be an explicit UI action, not an accidental side effect of every consumer's `resolve` call.
- Reload/revalidate on project file changes and signal artifact invalidation on builds/reloads. Consumers should not independently load or clear the active artifact.
- Align schema/runtime requirements and defaults, validate complete load-address syntax/range, and centralize executable classification with consistent case handling.
- Isolate scaffolding into a generation plan plus file writer. Preflight collisions and confirmation before overwriting an existing Makefile/source; avoid partially written projects where practical. This is a safety improvement, not a reason to introduce a general workflow engine.
- Replace synchronous filesystem work on hot Extension Host paths with async operations where measured latency warrants it. CPU-heavy parsing may eventually need a worker, but profile before adding worker/process complexity.
- Use atomic file replacement for persisted project settings and exported disk images where feasible; preserve remote/virtual-workspace behavior intentionally rather than assuming every URI is a local path.

### 9.4 Performance, backpressure and resource budgets

- Replace independent async `setInterval` refresh loops with non-overlapping/coalesced refresh control. A slow request must not build an unbounded service or IPC backlog.
- Measure IPC queue wait, on-wire time, command class, queue depth and dropped/coalesced telemetry. Record session/operation tokens with errors; avoid logging raw pixels or large memory payloads.
- Distinguish control latency, frame rate, metadata parse time, hover deadline and list render responsiveness. Priority scheduling cannot interrupt a request already in flight.
- Preserve single-consumer overlay delta retrieval. Coalesce extra requests without losing consumed updates or replaying deleted overlays.
- Cache symbol IDs/lookups instead of reconstructing `allSymbols()` for each `symbolById` call. Cache definitions by source version/artifact identity; avoid clearing caches on every token resolution.
- Current Symbols rendering is batched but eventually retains all matching DOM nodes; Memory Edits/Performance/Scripts rebuild full row sets. Add paging/virtualization or keyed updates only after collection-size profiling. Reuse a window/list primitive where behavior truly matches; do not make tiny fixed Ports tables virtual.
- Bound retained webview context, cache size and outstanding promises. Dispose/invalidate does not automatically cancel backend work.

### 9.5 Security, trust, and compatibility

- Preserve nonce CSPs and `textContent`; centralize escaping and resource roots. Settings currently uses inline style permission while other panels use external styles. Prefer external/nonce styles, without claiming a demonstrated exploit.
- Restrict trusted hover Markdown to the specific registered source-navigation command instead of broad `isTrusted = true`; validate command arguments and allowed navigation paths.
- Check workspace-trust behavior before launching configured executables, loading/running server scripts, or writing/exporting images. No explicit workspace-trust policy/check was found; this is an audit item, not a claim that VS Code permits every action in restricted mode.
- Runtime validation should bound text sizes, collection sizes, frame lengths and persisted history, including malformed browser messages.
- The manifest declares VS Code `^1.85.0`, but installed `@types/vscode` is 1.110.0 and code uses newer stack-item APIs. Audit minimum API introduction and run minimum-version tests; either guard/fallback or deliberately raise/document the engine floor. Compiling against a caret-updated type package does not prove compatibility with the declared minimum.
- Preserve protocol-version/schema validation and record producer/emulator versions with conformance fixtures. The MessagePack dependency is a prerelease version range; review update/reproducibility policy separately from refactoring.

### 9.6 Dead paths, conventions and documentation

- `C:\Work\Programming\v6vscode\src\emulator\panel\cpu-statistics-panel.ts` has no production references in the source scan and overlaps newer Hardware Statistics presentation. Verify public/manual use, then delete it or explicitly justify it; do not maintain two dormant implementations indefinitely.
- Define consistent terminology: `Panel` versus `Provider`, connection/session/stop/filter generations, address versus value, availability versus UI loading/error state.
- Keep stable public model interfaces readonly where server snapshots are authoritative; freeze consistently only where it protects invariants, not as ceremony.
- Historical design documents marked Implemented describe intentions, not a current executable contract. Update the architecture overview and maintain ADRs for session ownership, expression semantics, artifact caching and UI sharing. Link this roadmap to existing language/C-debug plans rather than replacing useful history.

## 10. Testability and verification strategy

### 10.1 Preserve the current strengths, change the weak seams

Use Mocha and existing test infrastructure first. Pure codec/query/value tests are valuable. Source-string tests also have a place for manifest packaging or prohibited APIs, but they should not be the main evidence for interactive behavior.

Examples of brittle implementation checks:

- `C:\Work\Programming\v6vscode\test\unit\debug\scripts-webview.test.ts` checks source substrings instead of executing filtering/editing/menu behavior.
- `C:\Work\Programming\v6vscode\test\unit\debug\performance-webview.test.ts` checks specific handler text and exact CSS tracks.
- Several adapter tests mutate private members through `as any`, making class extraction harder than behavior change.
- `C:\Work\Programming\v6vscode\test\register.js` and `C:\Work\Programming\v6vscode\test\helpers\mock-vscode.ts` provide divergent mocks. The bootstrap also patches Node's module resolver globally.

Introduce public port fakes for session, transport, clock, artifact repository and navigation. Test extracted service behavior through those ports. Retain a minimal central VS Code mock for host adapter tests; reset mutable state after every test. Reduce private-field setup as seams are extracted, not by adding production-only test setters.

### 10.2 Required behavior matrix

| Area | Required cases |
|---|---|
| Ordered transport | Partial/multiple frames; timeout and late response; close during request; disconnect with queue; reconnect; rejected connect; priority; queue cap; maximum frame size |
| Session | Launch/run/debug/attach; negotiation failure; old process exit; concurrent stop; owner versus borrowed process; rejected concurrent session; repeated start/stop |
| Scoped async work | Queue action in A then connect B; stale post-await mutation; hide/recreate panel mid-read; cancellation; refresh coalescing; queue recovery; disposed listeners/timers |
| DAP identity | Scopes versus Watch children; delayed cross-stop references; selected caller frame; inline frame visibility; all handles invalidated on reset/reload |
| Values | Byte/word/dword, signed/unsigned, alias/qualifier, enums/bools/chars, pointers/null, arrays, struct/pool summary and expansion, partial/unreadable data; signed comparisons and overflow policy |
| Expressions | Shared numeric vectors; address versus value meaning; dotted ASM constants versus C members; bounded input/depth; rejected side effects |
| Artifacts/source | Same-path rebuild; missing/mismatched ROM; concurrent loads; multiple units; dirty document; compiled-site remapping; project switch; duplicate symbol names |
| Collection services | Feature-specific acknowledgement/revision rules; reconcile after failure; running permissions; capacities; malformed payload; stale mutation rejection |
| Browser shared components | Menus, focus return, keyboard navigation, disabled actions, drafts/errors, double-submit protection, query history, hidden view, stale messages and locale/case matching |
| Packaging/compatibility | Built assets resolve in installed VSIX; no Node imports in browser modules; CSP/resources; minimum and current VS Code; platform path semantics |

Cross-surface parity tests should compare **domain results**, not require identical entire UI strings where address/content or DAP/Markdown semantics intentionally differ.

### 10.3 Make fixture tests deterministic

- All 26 currently pending cases are optional demo ELF suites. Make representative mandatory fixtures self-contained or reproducibly generated, and report intentionally optional skips clearly.
- Keep fixture resolution centralized and checked from both source tests and compiled tests. The real C metadata fixtures ran in this audit; the 26 pending demo-artifact cases must not be confused with them.
- Tests that spawn a real emulator should be classified as integration/conformance rather than silently running inside unit tests when an environment variable happens to be set.
- Keep mandatory unit fixtures toolchain-independent. Put pinned producer build recipes/checksums and explicit prerequisites in conformance jobs; do not require an unrelated local checkout.
- Existing packaged and real-emulator tests are a good base. Add behavioral browser tests before moving shared JS, using a small harness/actual Extension Host where sufficient. Evaluate a browser-test dependency only if existing tooling cannot cover needed DOM behavior reliably.

### 10.4 CI/build gates

`npm run ci` currently runs compile, lint, unit and regression, but not packaged or real-emulator integration. No checked-in CI workflow was found under the repository's `.github` tree during this audit; external automation may exist.

Recommended tiers:

1. **Every change:** host compile, browser compile/check, lint with no new warnings, deterministic unit/regression, import-boundary checks, manifest/schema parity, browser-shared algorithm tests.
2. **Pull-request integration lane:** Extension Host and packaged VSIX smoke; current and minimum supported VS Code where feasible.
3. **Gated conformance/release:** pinned emulator/compiler fixtures, protocol variants, C optimization levels, launch/attach and cross-surface values.
4. **Scheduled/manual profiling:** transport latency under multiple visible tools, large symbol/collection DOM size, activation and metadata parse cost.

Do not enable `--max-warnings 0` abruptly while 66 warnings exist. Baseline/ratchet warnings down. Resolve Node test-module warnings deliberately; do not switch the entire extension to ESM just to silence a test warning.

## 11. Prioritized refactoring roadmap

### Priority and sizing

- **P0:** correctness/integrity defects reproduced or strongly evidenced; add a focused test and fix before broad extraction.
- **P1:** high-impact ownership/reuse/testability work that prevents repeated defects.
- **P2:** consistency and structural debt with lower immediate risk.
- **P3:** optional performance/organization improvements justified by measurements.

Effort estimates are planning ranges for one maintainer familiar with the code, including tests/review: **S** about 0.5-2 days, **M** 3-5 days, **L** 1-2 weeks. They are not delivery commitments; external producer/API changes can increase them. Tasks below are not all parallel and should be split into reviewable changes.

### 11.1 Short term: stabilize and establish shared contracts (first 2-3 iterations)

| ID | Priority / size | Task and dependency | Deliverable / exit criterion |
|---|---|---|---|
| R01 | P0 / M | Characterize/fix timeout/close/disconnect ordering (A1); no broad refactor prerequisite | Mock TCP/fake-socket regressions prove no response reassignment, all pending requests settle, failed streams cannot advance |
| R02 | P0 / S-M | Characterize/fix signed scalar interpretation and DWARF form alias (A11, section 9.2) as separate changes | Signed `-1 < 0` passes; DW_FORM block/block1 fixtures decode correctly; existing metadata/value tests remain green |
| R03 | P1 / S | Prevent cross-stop wire-handle reuse (A5) | Delayed references never resolve to a different value; scope/pool namespace regression retained |
| R04 | P1 / S-M | Establish test baseline and reproducible mandatory fixtures; centralize fixture resolution | Skips accounted for; fixture paths centralized; no optional environment-dependent unit execution; document integration prerequisites |
| R05 | P1 / M | Extract protocol error/result and primitive validation helpers (D2-D3) | Two feature codecs/services migrate first; field/code/reason preserved end to end; malformed payload tests share vectors |
| R06 | P1 / M | Add narrow session/clock/transport ports and scoped queue primitives (A4, D1), after R01 | Submitted-in-A mutation cannot execute in B; rejection leaves queues usable; deterministic timing tests |
| R07 | P1 / S-M | Deduplicate byte/numeric literal/hex helpers and ASM lexical masking (D6-D9) | Existing syntax/defaults preserved; byte/CPU/global width policies explicit; no new browser/host algorithm copy |
| R08 | P1 / M | Remove lifecycle.stop replacement and introduce awaited stop participants (A8) | FDD persistence exercised for all relevant owned-stop paths; idempotent shutdown; explicit failure policy |
| R09 | P1 / S-M | Audit minimum VS Code API compatibility and add boundary/manifest checks | Engine floor is truthful; current/minimum smoke strategy defined; no new core-to-panel dependencies |

**Short-term success:** integrity defects have regression tests, small extractions have at least two real consumers, no production rewrite, and every change preserves cross-surface values and existing launch/stepping behavior.

### 11.2 Medium term: consolidate ownership and migrate consumers (following 3-6 iterations)

| ID | Priority / size | Task and dependency | Deliverable / exit criterion |
|---|---|---|---|
| R10 | P1 / L | Session coordinator with explicit connection/execution/ownership; depends on R01/R06/R08 | Run/debug/attach share negotiation/process monitoring and scoped context; mode policies explicit; no stale exit or queue crossover |
| R11 | P1 / M-L | Versioned artifact repository and project-change integration (A6), after R06 | Same-path rebuild reloads correctly; concurrent loads coalesce; panels cannot clear shared symbols; immutable read handles |
| R12 | P1 / M | Validated memory backend with stopped/live adapters (A7), after R05/R06 | Address/length/capability checks identical at transport boundary; stop/live caches distinct; hardcoded preview capabilities removed |
| R13 | P1 / M-L | Extract ValueEvaluationService and move domain formatting/types out of adapter, after R02/R03/R11/R12 | Watch/Console/hover use one typed evaluation API; DAP and editor presenters own their own envelopes/links; no language-to-DAP helper imports |
| R14 | P1 / M-L | BreakpointCoordinator, ExecutionController/StopMonitor and typed DAP facade, incrementally after R10 | Adapter delegates policies; source/instruction/temporary ownership reconciles in one place; stop/control transition tests pass |
| R15 | P1 / M | Browser-aware build and shared pure host/browser modules, after R07/R09 | Main verification checks browser code; actual script matching/number parsing/address mapping share implementation; packaged resource imports pass |
| R16 | P2 / M-L | Webview document/panel/message infrastructure and RefreshController, after R06/R15 | Pilot Performance + Memory Edits; one ready/visibility/disposal/CSP path; malformed/stale message tests; feature-specific policies remain local |
| R17 | P2 / M | Shared browser menus/history/edit helpers and CSS, after R15 and behavioral tests | Pilot Scripts + Performance; same keyboard/focus/error behavior; duplication removed from migrated consumers, not only wrapped |
| R18 | P2 / M | Normalized project settings/schema parity, ProgramLoader and navigation ports | Run/reload/debug prepare requests consistently; settings changes update active context; no concrete sibling-panel dependency for navigation |

**Medium-term success:** new tools can reuse lifecycle, refresh, checked messaging, validation and browser interaction primitives without copying an existing feature. The remaining DAP adapter is a readable protocol map. Existing public commands, wire schemas, view IDs and project formats remain compatible unless an explicit migration is approved.

### 11.3 Long term: simplify mature areas and strengthen guarantees

| ID | Priority / size | Task and dependency | Deliverable / exit criterion |
|---|---|---|---|
| R19 | P2 / L | Consolidate legacy/semantic DIE decoding after fixture and differential coverage | One form/abbreviation implementation, versioned projections, preserved baseline fallback and no metadata coverage loss |
| R20 | P2 / M-L | Unify bounded expression AST/evaluation policies if R07/R13 reveal a stable common core | Address/C dialects documented; no duplicate lexer/arithmetic semantics; compatibility vectors prove precedence and lookup meaning |
| R21 | P2 / M | Tighten public/domain types, warning ratchet, typed events and private-state-free tests | New core work needs no VS Code mock; fewer `any` boundary escapes; event and lifecycle contracts executable |
| R22 | P3 / M per bottleneck | Profile-driven caches, keyed/virtualized lists and parsing offload | Measured before/after queue latency, DOM bounds and responsiveness; no speculative worker/framework migration |
| R23 | P2 / M | Package/min-version/conformance gates and architectural documentation | Release pipeline tests the shipped assets and declared API floor; documented owner and invariants per shared service |
| R24 | P3 / S-M | Remove verified dormant CPU statistics/obsolete compatibility facades | No production references, contract coverage retained, docs updated; no removal merely because a file looks old |

### 11.4 Dependency sequence and suggested first changes

```text
R01 transport safety --------------------> R06 scoped async -----> R10 session
R02 value/form correctness -> R03 handles      |                     |
R04 mandatory fixtures -> R05 validators       +-> R11 artifacts ----+-> R13 values
                         R07 pure rules        +-> R12 memory -------+
R08 stop participants -------------------------------------------> R10
R09 API/boundary gates -> R15 browser build -> R16 host shell -> R17 browser UI
R10 session -> R14 debugger policies; R11/R18 -> project/artifact coherence
R04/R05/R11/R13 -> R19/R20 deeper parser/expression consolidation
```

Suggested first reviewable changes:

1. Transport timeout/late-response regression and ordered-stream failure fix only.
2. Signed scalar and DWARF form corrections, each with focused fixtures and separately reviewable tests.
3. Monotonic DAP wire handles plus delayed-request regression.
4. Checked response/error/validation helpers with two migrated features; no folder reorganization.
5. Scope-bound queue/refresh primitives with a reconnect-during-mutation test.
6. Browser compile/behavior harness and migration of script matching plus numeric literals.

Do not merge all groundwork into a giant prerequisite branch. Each slice should improve production behavior or remove real duplication and remain releasable.

## 12. Migration rules, acceptance criteria, and measures

### 12.1 Rules for each extraction

1. Write a characterization/contract test before moving policy.
2. Identify the single owner and at least two actual consumers, unless the extraction isolates a correctness-critical boundary.
3. Add the smallest shared implementation that expresses the invariant; use composition.
4. Migrate one representative consumer, then a genuinely different second consumer. Refine only from those needs.
5. Delete duplicated implementations in the same slice or track a short-lived adapter with a removal milestone. New shared code unused by production is not completed reuse.
6. Keep public commands, project JSON, IPC schemas and UI actions stable. Separate intentional behavior changes from mechanical moves.
7. Run relevant tests and packaged checks for asset changes. Keep old immutable projections as temporary facades, not independently evolving logic.
8. Capture timings only when measuring a performance claim; code-line reduction is not a success metric by itself.
9. Preserve existing uncommitted work while applying approved slices. Commit and submit only with explicit user approval.

### 12.2 Definition of done

- No new core-to-concrete-panel dependencies; import-boundary checks pass.
- All migrated consumers execute the shared implementation, including the browser when applicable.
- Structured errors retain command/code/field context through the UI boundary.
- Scope-bound operations cannot mutate or publish into a replacement connection/panel/stop.
- Disposal is idempotent; timers/listeners/pending operations have a named owner.
- Mandatory tests are deterministic; expected optional skips have explicit prerequisites.
- Compile, checked browser build, lint ratchet, unit/regression and relevant integration tests pass.
- User-visible differences are deliberate and documented; cross-surface parity covers field type/width and address-versus-value semantics.
- Shared contracts and owner are documented; temporary compatibility paths have removal criteria.

### 12.3 Track outcomes, not vanity targets

Record a baseline and trend for:

- Number of copied algorithm/helper bodies in migrated categories; aim for one implementation per stable policy, not zero similar-looking code.
- Core-to-view and concrete lifecycle dependencies; allow stable pure model fan-in.
- Session-crossover/stale-result regressions and transport orphan/timeout tests.
- Browser runtime behavior covered versus source-string-only assertions.
- Mandatory fixture execution, documented optional skips, and lint warning count.
- Adapter responsibility count and ease of testing via ports; line count is secondary.
- IPC queue wait/on-wire latency, maximum queue depth, active pollers, retained DOM/cache size, hover and source-lookup latency.
- Change amplification: how many files must change to add one common menu behavior, numeric syntax or protocol-error policy. Expect two adapters plus one shared policy at most for a genuinely common operation, not every feature.

## 13. Risks and non-goals

- **Over-generalization:** full CRUD services differ in revisions, atomicity, acknowledgement, capacities and consuming reads. Share mechanics while leaving those policies visible.
- **Wrong cache sharing:** stopped values must not inherit live-cache assumptions. Artifact identity includes file versions, not merely path.
- **State migration:** replacing lifecycle behavior can regress ownership and FDD persistence. Ship transition tests before moving consumers.
- **UI extraction:** common components can break focus, keyboard and CSP behavior. Migrate two panels with behavioral tests and keep feature CSS variables local.
- **Parser consolidation:** legacy paths preserve compatibility. Differential fixtures and structured degradation precede deletion.
- **Cancellation illusion:** timing out a promise does not cancel sent IPC; don't replay or issue dependent writes after an invalidation.
- **Dependency/library churn:** no new runtime framework, container, schema library or browser runner is required by this plan. Evaluate additions separately against actual gaps.
- **No broad format-only churn:** large renames/reformatting make semantic review and preservation of in-flight work harder.
- **No new feature commitment:** multi-session support, remote/virtual files, complete C arithmetic, floating point and producer changes require explicit scope. Enforce/describe current limits rather than accidentally claiming support.

## 14. Recommended decision

Approve the roadmap in stages, starting with R01-R04 and the small shared-contract pilots. The project's good feature modules should remain; centralize **session integrity, typed semantics, protocol validation, and shared UI behavior** around them. The architectural goal is not fewer folders or a clever framework: it is one reliable implementation of each shared rule, clear ownership of effects/state, and tests that prove every surface uses that implementation.

The original audit itself did not change runtime behavior. Stage 1 has since implemented R01-R04 as recorded above; remaining audit risks are follow-up items, not implied fixes.
