# V6emul Trace Log Query Interface

**Status:** Proposed
**Date:** 2026-08-07
**Consumers:** v6vscode Trace Log panel and other remote debugger clients
**Related work:** `trace-log-panel-plan.md`

## 1. Purpose

Expose retained executed-instruction history to remote clients without transferring the complete trace. The existing trace-log enable/disable commands remain file-logging controls and do not provide panel data.

Filtering and row retrieval are separate operations. A server creates a filtered result once, then provides a window of that data.

## 2. Availability

`GET_SERVER_INFO` must advertise:

```json
{
  "traceLogSchema": 1,
  "traceLogFilter": true,
  "traceLogWindowQuery": true,
  "traceLogLimits": {
    "capacity": 300000,
    "maxLines": 512,
    "maxPatternBytes": 64
  }
}
```

Add `DEBUG_TRACE_LOG_FILTER` and `DEBUG_TRACE_LOG_WINDOW` using the next available IPC command IDs. Clients without schema 1 and both commands must show an unsupported state; they must not infer trace data from logging.

## 3. Filter Contract

```ts
interface TraceLogFilterRequest {
  addressPattern?: string;
  instructionPattern?: string;
}

interface TraceLogFilterResponse {
  filterId: string;
  totalMatches: number;
}
```

Both patterns use case-insensitive `*` glob matching against canonical text. Omitted patterns match all retained instructions. Results are ordered newest first.

`filterId` identifies an immutable filtered result for the current paused state. It is opaque to clients and prevents delayed window requests from reading a newer filter accidentally. Creating a new filter for the same connection releases its previous filter. Resume, reset, disconnect, or emulator replacement invalidates it. It can be implemented as a monotonoc increment every filter request, and invalidation event (run, step).

`totalMatches` is the complete filtered-result size and allows the client to size its virtual scrollbar without retrieving all rows.

## 4. Window Query Contract

```ts
interface TraceLogWindowRequest {
  filterId: string;
  start: number;
  lines: number;
}

interface TraceLogWindowResponse {
  start: number;
  entries: TraceLogEntry[];
}
```

`start` is a zero-based index in the filtered result. `lines` is an application-controlled window size calculated from visible table rows plus overscan and clamped to `maxLines`.

The response repeats `start` and contains at most `lines` entries. A short or empty response at the end is valid. `totalMatches`, `start`, and `entries.length` fully describe the window without an additional continuation field.

## 5. Entry Contract

```ts
interface TraceLogEntry {
  offset: number;
  cpuAddress: number;
  globalAddress: number;
  opcode: number;
  bytes: number[];
  canonicalInstruction: string;
  operands: TraceOperand[];
}

interface TraceOperand {
  kind: 'register' | 'immediate' | 'punctuation' | 'text';
  text: string;
  value?: number;
  width?: 8 | 16;
  addressLike?: boolean;
}
```

- `cpuAddress` is the displayed 16-bit instruction address.
- `globalAddress` identifies the executed memory location for bank-aware navigation.
- `canonicalInstruction` is undecorated I8080 assembly with stable case and whitespace.
- `operands` identify immediate-token boundaries and whether an immediate is address-like. Clients must not parse rendered assembly to recover these facts.

## 6. Semantics and Errors

`offset` remains display data: `-1` is the newest retained instruction, `-2` the preceding instruction, and so on. It is not a filter input. Reset clears retained history. Repeated HLT suppression, if active, applies before records are exposed.

Clients create filters and query windows only while emulation is paused. Reject malformed or oversized patterns, unknown or expired filter IDs, invalid starts, invalid line limits, and unsupported schema usage with structured request errors.

The interface does not resolve debug symbols, navigate source, manage breakpoints, execute code, or write trace files. Those remain client responsibilities.