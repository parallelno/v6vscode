# Stop Record Extension Improvements

**Status:** Proposed
**Date:** 2026-08-01
**Depends on:** `v6emul-stop-record-design.md`

## 1. Goal

Use v6emul command `GET_STOP_RECORD` (95) to give users accurate stop reasons, breakpoint and watchpoint attribution, and useful exception details.

`HLT`, reset, and restart are not stop events. They do not create stop records and must not produce DAP `stopped` events unless a separate operation actually stops emulation.

## 2. Immediate Improvements

### 2.1 Accurate Run and Debug Status

Map each new stop record to one DAP `stopped` event:

| Emulator reason | DAP reason | User-visible result |
|---|---|---|
| `pause` | `pause` | Show that execution was paused. |
| `breakpoint` | `breakpoint` | Highlight the breakpoint that fired. |
| `watchpoint` | `data breakpoint` | Show the exact watchpoint and memory access. |
| `step`, `next`, `frameStep` | `step` | Attribute the stop to stepping. |
| `exception` | `exception` | Show the exception code and description. |
| `unknown` | `pause` | Stop without claiming an unsupported cause. |

The adapter should use `description` in the stopped event when present. It must not infer `HLT`, reset, or restart from an unchanged record.

### 2.2 Precise Breakpoint Attribution

Use `breakpointIds` from the record to populate DAP `hitBreakpointIds`. If backend IDs differ from DAP IDs, maintain an explicit backend-ID-to-DAP-ID map.

This replaces the current PC comparison and correctly handles conditional or overlapping breakpoints.

### 2.3 DAP Data Breakpoints

Enable data breakpoints only when the server advertises both structured watchpoints and stop-record schema 1:

- Advertise `supportsDataBreakpoints: true`.
- Implement `dataBreakpointInfo` and `setDataBreakpoints`.
- Map backend watchpoint IDs to DAP breakpoint IDs.
- Emit reason `data breakpoint` with mapped `hitBreakpointIds`.

### 2.4 Useful Watchpoint Feedback

Write a concise Debug Console message for a watchpoint stop:

```text
Watchpoint 7: write to 0x10000, 0x10 -> 0x20, stopped at PC 0x1234
```

The Watchpoints panel should highlight every ID in `watchpointIds`. The Hex Viewer should reveal `accessedGlobalAddress` without stealing editor focus.

### 2.5 Exception Details

Advertise and implement DAP `exceptionInfo` when stop-record schema 1 is available. Preserve the latest exception record until execution resumes so VS Code can request its code and description.

## 3. Integration Shape

Add the protocol support in the existing boundaries:

- Add `GET_STOP_RECORD = 95` and `stopRecordSchema` to `src/emulator/protocol/ipc-commands.ts`.
- Add typed stop-record models and runtime validation to `src/emulator/protocol/debug-models.ts`.
- Validate command 95 and schema 1 in `src/emulator/protocol/ipc-server-info.ts`.
- Replace stop inference in `src/debug/adapter/v6-debug-adapter.ts` with record mapping.

The polling path becomes:

```text
read current sequence as baseline
RUN
poll IS_RUNNING
execution stops
read GET_STOP_RECORD
validate that sequence changed
validate and map the record
refresh registers once
emit one DAP stopped event
update Watchpoints and Hex Viewer when applicable
```

Polling `IS_RUNNING` keeps the high-frequency backend check inexpensive. After it reports stopped, the adapter reads command 95 for authoritative attribution and verifies that its sequence differs from the baseline. The adapter must store the latest sequence per emulator session so a persistent record is not emitted twice. On reconnect or process replacement, it reads a fresh baseline before execution resumes.

## 4. Capability Handling

Authoritative stop attribution requires both:

```ts
serverInfo.commands.includes(IpcCommand.GET_STOP_RECORD)
serverInfo.capabilities.stopRecordSchema === 1
```

When either check fails, retain the current `IS_RUNNING` fallback for compatible older emulators. In fallback mode, do not advertise DAP data breakpoints or exception information.

## 5. Implementation Checklist

- [x] Add and validate protocol models, capability fields, and command 95.
- [x] Poll `IS_RUNNING` and fetch the stop record after execution stops.
- [x] Map backend breakpoint IDs to DAP breakpoint IDs.
- [x] Enable DAP data breakpoints and watchpoint hit attribution.
- [x] Highlight stopped watchpoints and reveal the accessed Hex Viewer address.
- [x] Add DAP exception information.
- [x] Add focused protocol and adapter tests.
- [x] Smoke-test the compatible external v6emul build from `V6EMUL`.

Live verification used `V6EMUL` pointing to v6emul `2026.07.31-07dba54` with IPC protocol 2. `GET_SERVER_INFO` advertised command 95 and `stopRecordSchema: 1`; `IS_RUNNING` reported the transition to stopped before `GET_STOP_RECORD` returned a persistent `pause` record with sequence `0 -> 1`.

## 6. Acceptance Criteria

1. Each new sequence produces exactly one DAP `stopped` event.
2. Persistent records never produce duplicate stopped events.
3. Breakpoint and watchpoint events contain mapped DAP IDs.
4. Watchpoint stops show access type, address, and available values.
5. Exception stops expose their code and description through DAP.
6. `HLT`, reset, and restart do not produce stopped events or change the stored baseline.
7. Older servers continue to work through `IS_RUNNING` without advertising unsupported capabilities.
