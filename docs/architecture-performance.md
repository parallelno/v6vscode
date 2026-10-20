# R22 measured bottleneck pilot

Run `node scripts/profile-architecture.cjs` from
`C:\Work\Programming\v6vscode`; run the Extension Host integration suite for the
real browser profile. These are local observations, not cross-machine CI timing
thresholds. Correctness tests assert work counts/identity, not elapsed time.

## Scripts / Performance unchanged snapshots

Baseline rebuilt every row and its handlers. Both consumers now execute the
shared keyed renderer outside edit mode; edits retain their existing draft path.
Entry/control-state signatures decide replacement, disappeared entries are
removed, session changes clear identities, and reorder preserves row identity.

Real VS Code 1.90 webview: 2,000 five-cell rows, 20 unchanged snapshots:

| | Baseline full rebuild | Keyed pilot |
|---|---:|---:|
| Row creations | 40,000 | 2,000 |
| Retained row bound | 2,000 | 2,000 |
| Script elapsed (one local run) | 522.3 ms | 101.1 ms |

The stand-in microbenchmark deliberately reports a contrary timing: 100 snapshots
created 200,000 versus 2,000 stand-in rows, but keyed JSON/index overhead took
about 134 ms versus 19 ms for trivial objects. It does not model DOM construction,
layout or handlers. The real packaged browser measurement justifies this pilot;
do not use synthetic object timings as paint/responsiveness claims.

Rows remain bounded by the filtered server collection, not a constant virtual
window. This is **not** a claim of full virtualization or cheap changed-statistic
updates. Existing Hex Viewer/Trace Log windowing remains unchanged. Broader
virtualization requires a representative larger workload and focus/scroll tests.

## Queue and artifact observations

Opt-in IpcClient timing reports successful command priority, submission queue
depth, queue wait and wire duration. No timing is collected without an observer;
observer failures cannot affect request attribution/order. A 32-PING local mock
burst measured median queue wait 13.95 ms, p95 20.06 ms, median wire 0.49 ms,
maximum submission queue depth 30. Priority/non-preemption policy is unchanged.

Committed 4,236-byte O2 ELF: cold repository decode 37.6 ms; 50 repeated content
checks/cache hits 3.43 ms total; one parse. The existing immutable version cache
already removes repeated parsing. No new cache, worker, offload or UI framework
was justified by this workload. Large-artifact responsiveness remains a future
measurement target, not a claimed solved problem.