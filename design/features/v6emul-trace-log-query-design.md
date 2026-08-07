# V6emul Trace Log Query Interface

**Status:** Proposed
**Date:** 2026-08-06
**Consumers:** v6vscode Trace Log panel and other remote debugger clients
**Related work:** `trace-log-panel-plan.md`

## 1. Purpose

Expose retained executed-instruction history to remote clients. The existing trace-log enable/disable commands remain file-logging controls; they do not provide panel data.

The interface returns only the number of rows requested by the client. It supports filtering by execution offset, 16-bit instruction address, and canonical assembly instruction.

## 2. Availability

`GET_SERVER_INFO` must advertise:

```json
{
  "traceLogSchema": 1,
  "traceLogQuery": true,
  "traceLogCoherentWhileRunning": true,
  "traceLogLimits": {
    "capacity": 300000,
    "maxLines": 512,
    "maxPatternBytes": 512
  }
}
```

Add `DEBUG_TRACE_LOG_QUERY` using the next available IPC command ID. Clients without schema 1 must show an unsupported state; they must not infer trace data from file logging.

## 3. Query Contract

```ts
interface TraceLogQueryRequest {
  lines: number;
  minOffset?: number;
  addressPattern?: string;
  instructionPattern?: string;
}

interface TraceLogQueryResponse {
  newestSequence: string;
  hasMore: boolean;
  entries: TraceLogEntry[];
}
```

`lines` is required. It is an application-controlled response limit, not a user filter. A client calculates it from its visible table height plus a small overscan and clamps it to `maxLines`.

`minOffset` is a negative integer. `-N` means include offsets `-N` through `-1`; omit it to search all retained history. `addressPattern` and `instructionPattern` use case-insensitive `*` glob matching against canonical text. Omitted patterns mean match all.

The server returns newest matching entries first and never returns more than `lines`. `hasMore` indicates that older matches exist beyond the response limit.

## 4. Entry Contract

```ts
interface TraceLogEntry {
  sequence: string;
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
- `sequence` and `newestSequence` are opaque decimal strings.

## 5. Semantics and Errors

Offsets are relative to the newest instruction included in the response snapshot. Reset clears retained history. Repeated HLT suppression, if active, applies before records are exposed.

Reject invalid line limits, offset ranges, malformed or oversized patterns, and unsupported schema usage with structured request errors. A client may refresh while execution runs when `traceLogCoherentWhileRunning` is true; otherwise it refreshes only while paused.

The interface does not resolve debug symbols, navigate source, manage breakpoints, execute code, or write trace files. Those remain client responsibilities.