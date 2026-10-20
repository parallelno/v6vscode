# Shared owners and invariants

| Owner | Shared contract / invariant | Primary verification |
|---|---|---|
| IpcClient | One active response stream; failure drains without replay; scoped dispatch; optional timing cannot affect ordering | transport fragment/orphan/timeout/priority tests |
| SessionCoordinator | Owned Run/Debug versus borrowed attach; one connection identity; awaited stop participants; old cleanup cannot target a replacement | session/stop persistence and live conformance |
| SessionOperations | Capture identity before enqueue; check dispatch/completion; no old publication; refresh coalesces per session | scoped service tests |
| ProgramLoader / NormalizedRun | Immutable captured bytes/settings; explicit LOAD_ROM/SET_MEM/FDD policies; validate before dispatch | medium-term project/program contracts |
| ArtifactRepository | Content fingerprints/versioned immutable handles; independent selections; bounded entries/input size; no stop/live memory sharing | artifact/project/fixture tests |
| DwarfReader | One form/abbreviation decoder; root-only baseline projections independent of semantic features | v4/v5 projection/form/boundary fixtures |
| Expression syntax / value domain | Shared bounded syntax/arithmetic; explicit address/C dialect; typed memory/value semantics outside DAP | dialect/value/hover parity tests |
| MemoryBackend | Capability/range/echoed-address/length/byte checks at wire boundary; distinct stopped/live adapters | shared malformed vectors and live values |
| BreakpointCoordinator / ExecutionController / StopMonitor | Reconciled ownership; acknowledged controls; stop polling cannot publish after invalidation | session policy/stepping tests |
| PanelHost / WebviewDocument | Token-bound ready/visibility/disposal/CSP; unknown message decoder; no stale document callbacks | pilot infrastructure/diagnostic tests |
| RefreshController | One active/latest refresh; scoped publication; completion polling/backoff; no disposal publication | infrastructure coalescing tests |
| Browser menu/edit/history/keyed rows | DOM-only strict ESM; feature policies local; preserved keyboard/focus/draft; bounded identity retention | behavioral stand-ins plus packaged CSP/profile |
| ProjectRepository / ActiveProjectService | Save captured snapshot, publish after persistence; old reads cannot overwrite saved settings | project/settings contract tests |
| Navigation ports | Source/memory intent without concrete sibling panels; exact lookup/bank policy remains feature-owned | navigation/import gates |

No service locator or universal CRUD/panel superclass is used. Structural ports
are introduced where they enable real consumers/testing; shared pure models may
have high fan-in. Runtime VS Code belongs to host/UI adapters, not parsing/value
or browser-safe shared modules. Domain results do not carry Markdown/DAP handles.

## Release verification

`npm run verify:release` is the fail-closed local/release lane. It requires a real
debugger-enabled `V6EMUL`, cleans output to prevent obsolete modules shipping,
runs deterministic CI and full test typecheck, packages the VSIX, executes shipped
current/minimum VS Code tests with zero skipped tests, and runs live conformance.
It writes stage exits/timings to `temp/release-verification.json`; it does not
publish, tag, commit or push.

`.github/workflows/verification.yml` runs deterministic checks on Windows.
`release-verification.yml` is manually dispatched on a trusted self-hosted Windows
runner labelled `v6emul`, configured with repository variable `V6EMUL`. There is
no emulator binary download/supply-chain guess and no silent live-test omission.
An absent runner queues the workflow; an absent executable fails prerequisites.
Do not run untrusted pull requests on that runner. Repository protection/release
approval must require the successful report; this code cannot configure remote
repository branch protections or provision a runner.