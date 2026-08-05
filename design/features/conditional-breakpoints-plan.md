# Conditional, Hit-Count, Logpoint, and Triggered Breakpoints Plan

**Status:** Proposed
**Date:** 2026-08-05
**Owners:** v6vscode maintainers
**Related work:** `debug-adapter-and-debug-views-plan.md`, Step 3.11; `stop-record-extension-improvements.md`; `v6emul-stop-record-design.md`

## 1. Problem

### 1.1 Current Behavior

The debug adapter supports source and instruction breakpoints, resolves each breakpoint to a 16-bit CPU address, and installs a structured breakpoint in v6emul. It does not advertise these DAP capabilities:

```ts
supportsConditionalBreakpoints: true
supportsHitConditionalBreakpoints: true
supportsLogPoints: true
```

The adapter currently ignores `condition`, `hitCondition`, and `logMessage`. Accepting those fields without implementation would install an unconditional stopping breakpoint and violate the user's request.

The structured v6emul breakpoint schema supports one register comparison through `operand`, `condition`, and `value`. It does not provide hit counters, log messages, or triggered-breakpoint dependencies.

VS Code also supports **Wait for Breakpoint**, commonly called a triggered breakpoint. This is a VS Code client feature rather than a published DAP feature. The current DAP schema has no `triggeredBy` request field and no `supportsTriggeredBreakpoints` capability. VS Code keeps a dependent breakpoint pending and sends it to the adapter only after a visible stopped event identifies the selected trigger breakpoint by its DAP ID.

### 1.2 Desired Behavior

Support four breakpoint behaviors:

1. Register comparison conditions translated exactly to v6emul.
2. Positive-integer hit conditions enforced by v6emul.
3. Source logpoints interpolated and emitted by the adapter without a visible stop.
4. VS Code-managed triggered breakpoints activated through stable DAP IDs and exact hit attribution.

Examples:

```text
Condition: A == 0x10
Hit Count: 5
Log Message: frame={HL}, color={A}
Wait for Breakpoint: main.asm:42
```

Conditions and hit counts may be combined with logpoints. v6emul applies the condition and counter before the adapter selects the final action:

- An ordinary breakpoint emits `stopped`.
- A logpoint emits `output` and resumes.
- A hit below its threshold resumes without output or a visible stop.

A triggered dependent remains absent from adapter requests until VS Code observes a visible stop for its trigger point.

Unsupported or malformed input must never degrade to an unconditional stopping breakpoint. The adapter returns an unverified DAP breakpoint with a precise diagnostic.

### 1.3 Breakpoint Identity Invariant

There is exactly one adapter breakpoint for each 16-bit CPU address. The address is the canonical identity for backend installation, stop attribution, requested hit condition, and logpoint state. The backend owns the mutable remaining counter.

```ts
interface AdapterBreakpoint {
    id: number;
    address: number;
    condition?: ParsedBreakpointCondition;
    hitCondition?: number;
    logMessage?: ParsedLogMessage;
    backendInstalled: boolean;
}
```

The adapter keeps a direct map:

```ts
Map<number, AdapterBreakpoint> // CPU address -> breakpoint
```

On a breakpoint stop, the adapter looks up the one breakpoint at the reported address. It does not search for a collection of logical breakpoints.

Several source requests may resolve to the same address, but they refer to the same adapter breakpoint and receive the same DAP breakpoint ID. Identical configurations are compatible. Requests resolving to one address with different conditions, hit conditions, or log messages conflict; the later request is unverified and acknowledged state remains unchanged.

### 1.4 Root Cause

The existing adapter tracks IDs and source ownership through address maps and sets, but does not represent complete breakpoint configuration. Therefore:

- DAP condition and logpoint fields are ignored.
- Configuration-only changes are not reconciled.
- The server-side `counter` field is not yet used.
- Stop handling publishes every backend breakpoint stop immediately.
- Stable IDs and exact hit attribution are not yet tested as a triggered-breakpoint contract.
- Capability advertising correctly remains disabled.

## 2. Strategy

### 2.1 Approach: Backend Conditions and Client-Side Actions

Use each layer only for behavior it can implement exactly:

- Parse and validate DAP input in the adapter.
- Translate register comparisons into `BreakpointAddRequest` fields.
- Let v6emul evaluate register conditions while executing.
- Pass hit thresholds to v6emul as the structured breakpoint `counter` field.
- Interpolate logpoint messages from one captured stopped-state snapshot.
- Resume internally for logpoints.
- Publish visible stops with stable canonical DAP IDs.
- Let VS Code activate triggered dependents after their trigger point stops.

No v6emul protocol extension and no custom DAP field are required.

### 2.2 Stop Processing Pipeline

The authoritative stop record identifies the breakpoint address. Since one address has one adapter breakpoint, runtime processing is a constant-time lookup:

```text
backend breakpoint stop
        |
        v
lookup breakpoint by address
        |
        v
    v6emul has already matched condition and counter
        |
        +-- logpoint -> interpolate, emit output, resume
        |
        +-- ordinary -> emit visible stopped event
```

When the visible ordinary breakpoint is a trigger point, VS Code observes its DAP ID in `hitBreakpointIds`, activates the dependent for the current session, and resends the affected source breakpoint set. The adapter installs the newly submitted dependent like any other source breakpoint.

### 2.3 Supported Condition Grammar

The first release accepts one register operand, one comparison operator, and one numeric or symbol expression:

```text
condition := register comparison valueExpression
comparison := "==" | "!=" | "<" | ">" | "<=" | ">="
```

Whitespace is optional. Register names are case-insensitive and normalized to the backend wire name.

Supported operands are the existing `BreakpointOperand` values:

```text
A F B C D E H L PSW BC DE HL CC SP
```

The right side uses the existing safe symbol-expression parser. It accepts decimal, `0x`, `$`, and `h` numeric forms, symbols, unary signs, parentheses, addition, subtraction, and multiplication. It never executes JavaScript.

| DAP operator | Backend condition |
|---|---|
| `==` | `EQU` |
| `!=` | `NOT_EQU` |
| `<` | `LESS` |
| `>` | `GREATER` |
| `<=` | `LESS_EQU` |
| `>=` | `GREATER_EQU` |

An absent or empty condition maps to backend condition `ANY`.

Byte registers accept values in `0..0xFF`; word operands accept `0..0xFFFF`. `PSW` and `CC` are enabled only after their width and comparison semantics are verified against v6emul. Until then, they are rejected explicitly.

The first release does not support memory expressions, boolean composition, register-to-register comparison, assignment-like `=`, or arbitrary Watch expressions.

### 2.4 Supported Hit-Condition Grammar

The first release accepts an unsigned decimal positive integer:

```text
hitCondition := [1-9][0-9]*
```

The value must be a safe JavaScript integer. Zero, negative values, hexadecimal values, relational operators, and modulo expressions are rejected.

An absent or empty hit condition means the request omits `counter`, allowing v6emul to use its default of `1`.

For threshold `N`, v6emul decrements `counter` for every matching visit, stops when it reaches zero, and remains stopping on later matching visits until replaced, disabled, or deleted. Thus `5` stops or logs on hit 5 and every qualifying hit thereafter. Future exact-hit or modulo syntax must be explicit and must not change this rule.

### 2.5 Counter Semantics and Lifecycle

v6emul owns the mutable remaining `counter`; the adapter stores only the requested normalized hit condition. An unchanged `setBreakpoints` request must not re-add the backend breakpoint, so its remaining counter is preserved in v6emul.

v6emul initializes or replaces the counter when:

- The breakpoint is created.
- Its normalized condition or hit condition changes.
- Its resolved address changes.
- It is removed and recreated.
- The emulator is restarted, reset, reloaded, replaced, or disconnected.
- The adapter reapplies breakpoints into a new backend session.

Log-message-only changes must preserve the server counter: update adapter-side logpoint state without reinstalling the backend breakpoint. Pause, continue, Step Into, and Step Over do not reset counters.

### 2.6 Logpoint Syntax and Interpolation

A source breakpoint with a non-empty DAP `logMessage` is a logpoint. DAP requires it to log rather than break and requires expressions inside `{}` to be interpolated.

The first release supports:

- Literal text.
- Register names inside braces.
- Numeric and symbol expressions accepted by `evaluateSymbolExpression`.
- `{{` and `}}` for literal braces.
- A trailing newline when the formatted message does not already have one.

Examples:

```text
frame={HL}, color={A}
stack top={SP}, buffer end={buffer + 16}
literal braces: {{value}}
```

Parse and validate the template during `setBreakpoints`. Store immutable literal and expression segments so runtime formatting does not rescan arbitrary syntax. Unmatched braces, empty expressions, unsupported expressions, or a template above a documented size bound make the breakpoint unverified.

At a qualifying hit:

1. Refresh registers once.
2. Resolve registers from that snapshot and symbols from `DebugIndex`.
3. Evaluate all segments without side effects.
4. Emit one DAP output event.
5. Resume internally without `stopped` or `continued`.

```ts
{
    category: 'console',
    output: formattedMessage,
    source: resolvedSource,
    line: resolvedLine,
}
```

Bare byte registers use `hex2`; bare word registers and 16-bit results use `hex4`. Other safe integers use one documented format fixed by unit tests.

If interpolation unexpectedly fails at runtime, emit one concise error output containing the location and failed expression, then resume. A formatting failure does not turn a logpoint into a visible stop. If automatic resume fails, expose the actual paused state.

Conditions and hit counts gate log messages in DAP order:

1. v6emul applies the register condition and decrements its counter.
2. The adapter formats and emits the message after a server-side qualifying stop.

Logpoints apply only to `SourceBreakpoint`; DAP `InstructionBreakpoint` has no `logMessage` field.

### 2.7 Triggered Breakpoint Contract

Triggered breakpoints are orchestrated by VS Code and require no backend or custom adapter state.

The trigger point is an ordinary source breakpoint with a stable DAP ID. The dependent carries `triggeredBy` only in VS Code's internal debug model and is marked pending. It is not included in `setBreakpoints` sent to the adapter.

When the trigger point produces a visible `stopped` event whose `hitBreakpointIds` contains its DAP ID, VS Code marks the dependency triggered for that session and resends `setBreakpoints` for the dependent source. The adapter then installs the dependent.

Adapter requirements are:

- Preserve DAP IDs across unchanged reconciliation and successful configuration replacement.
- Include the exact canonical ID in every visible breakpoint stop's `hitBreakpointIds`.
- Return breakpoint responses in request order.
- Accept a later source replacement that introduces an activated dependent.
- Preserve unrelated source breakpoints when the dependent is introduced.
- Remove an activated dependent when a later source replacement omits it.
- Leave dependency lifecycle and pending state to VS Code.

A trigger point must produce a visible stop. A logpoint never emits `stopped`, and a visit before its server-side counter reaches zero produces no stop, so neither activates a dependent. A trigger point with a condition or hit count activates dependents only on a qualifying visible stop.

There is no DAP `supportsTriggeredBreakpoints` capability to advertise. Support is verified through VS Code UI behavior and the standard ID and stopped-event contract.

### 2.8 Stop Filtering and Internal Resume

Filtering occurs after validating a new authoritative stop record but before setting adapter-visible state to paused or emitting DAP state events.

For a breakpoint record:

1. Extract `breakpointAddress` from the stop record.
2. Look up the one `AdapterBreakpoint` by address.
3. If none exists, publish an unattributed backend breakpoint stop. Never auto-resume an unknown or external breakpoint.
4. The server has already applied the condition and counter before producing this record.
5. If a log message exists, emit output and resume internally.
6. Otherwise complete normal stop handling and emit the breakpoint's DAP ID.

The internal resume path must:

- Advance the stop-record baseline so the record cannot be processed twice.
- Clear transient register caches after required formatting.
- Send `RUN` and restart polling.
- Keep adapter-visible state running.
- Emit neither `stopped` nor `continued`, because VS Code never observed the backend's brief stop.
- Avoid unrelated UI and panel refreshes.

If internal resume fails, expose the actual paused state. Refresh registers, emit `stopped` with reason `breakpoint`, and describe the failed automatic action. Log the failure.

Logpoints require authoritative stop records for address attribution. Hit conditions require structured breakpoint schema 1 with its `counter` field. Older backends remain usable for ordinary breakpoints but do not advertise unavailable features.

### 2.9 Reconciliation

Source and instruction handlers normalize requests into the same address-keyed configuration:

```text
address + normalized condition + normalized hit condition + normalized log message
```

Outcomes:

- **New address:** allocate one DAP ID and add the backend breakpoint, including `counter` when requested.
- **Unchanged configuration:** preserve ID and do not resend the add, preserving the server's remaining counter.
- **Condition or hit-condition change:** replace the backend configuration with the same ID; v6emul initializes a new counter.
- **Log-message-only change:** update adapter state without replacing the backend breakpoint or resetting its counter.
- **Removed final reference:** delete the backend breakpoint and discard its state.
- **Compatible duplicate:** reuse the existing breakpoint and ID.
- **Conflicting duplicate:** retain acknowledged state and return the conflict as unverified.

Backend replacement is delete-then-add because schema 1 has no edit command. If deletion succeeds but addition fails, mark the breakpoint unverified and remove installed state. If deletion fails, retain the previous acknowledged configuration.

Temporary Step Over breakpoints remain internal and do not participate in hit counts, logpoints, or triggered IDs. They must never overwrite a user breakpoint at the same address.

### 2.10 Backend Request Construction

Extend the shared builder so ordinary and conditional breakpoints use one path:

```ts
makeBreakpointAdd(address, comment, {
    operand: parsedCondition?.operand ?? 'A',
    condition: parsedCondition?.condition ?? 'ANY',
    value: parsedCondition?.value ?? 0,
    ...(parsedHitCondition === undefined ? {} : { counter: parsedHitCondition }),
    autoDelete: false,
});
```

Log messages remain adapter state. The optional backend `counter` is a positive unsigned integer and defaults to `1` when omitted. Backend comments continue to identify adapter ownership and DAP ID.

### 2.11 DAP Responses and Diagnostics

Verified responses retain resolved line and instruction reference. Their message summarizes active behavior:

```text
CPU address: 0x013C; condition: A == 0x10; hit count: 5; logpoint
```

Representative rejections:

```text
Unsupported breakpoint condition. Expected: REGISTER comparison value.
Unsupported breakpoint register: PC.
Breakpoint value 0x100 does not fit register A.
Hit condition must be a positive decimal integer.
Log message contains an unmatched '{'.
Unsupported logpoint expression: memory[HL].
Breakpoint address 0x013C already has a different configuration.
The active emulator does not provide authoritative stop records required for hit conditions and logpoints.
```

Never return `verified: true` unless backend and adapter-side behavior match the request.

### 2.12 Capability Advertising

Advertise backend-translated conditions with structured breakpoint support:

```ts
supportsConditionalBreakpoints: true
```

Advertise server-side hit conditions with structured breakpoint schema 1 and its advertised counter limits. Advertise logpoints only with structured source breakpoints and authoritative stop records:

```ts
supportsHitConditionalBreakpoints: true
supportsLogPoints: true
```

Do not advertise a triggered-breakpoint capability. None exists in the current DAP schema.

Verify initialize-time versus dynamic capability behavior in the supported VS Code version. A late `capabilities` event is best effort and may be too late to enable breakpoint editor UI.

## 3. Implementation Steps

### Step 3.1 - Confirm Protocol and VS Code Semantics [ ]

Read DAP definitions for source and instruction breakpoints, capabilities, responses, output, stopped, and continued events. Inspect the supported VS Code triggered-breakpoint flow. Verify v6emul operand widths and comparison signedness.

> **Implementation Notes:**

### Step 3.2 - Add Pure Condition Parsers [ ]

Add typed parsers for register conditions and positive-decimal hit conditions. Reuse `evaluateSymbolExpression` for values and return actionable validation errors.

> **Implementation Notes:**

### Step 3.3 - Add the Log Message Parser [ ]

Parse bounded templates into immutable literal and expression segments. Define escaping, validation, formatting, and maximum size. Add table-driven tests.

> **Implementation Notes:**

### Step 3.4 - Introduce the Address-Keyed Model [ ]

Replace split state with one canonical record per address. Keep desired source and instruction sets as references so removals remain ownership-safe.

> **Implementation Notes:**

### Step 3.5 - Build Conditional Backend Requests [ ]

Extend the shared request builder. Verify exact wire fields and ordinary `ANY` behavior.

> **Implementation Notes:**

### Step 3.6 - Reconcile Complete Configuration [ ]

Detect condition-only, hit-condition-only, and log-message-only changes. Preserve IDs, preserve the server counter for unchanged and log-message-only requests, and install a new counter only when backend configuration changes.

> **Implementation Notes:**

### Step 3.7 - Send Server-Side Hit Counters [ ]

Send each parsed hit condition as `counter` in `DEBUG_BREAKPOINT_ADD`. Verify v6emul produces no stop before the counter reaches zero and continues stopping after it does.

> **Implementation Notes:**

### Step 3.8 - Emit and Resume Logpoints [ ]

Capture registers once, interpolate one message, emit one located output event, and resume. Handle formatting and resume failures according to this design.

> **Implementation Notes:**

### Step 3.9 - Verify Triggered Breakpoint Activation [ ]

Verify a pending dependent is absent initially, a visible trigger stop reports the stable ID, and VS Code subsequently submits the dependent. Cover same-source and cross-source dependencies.

> **Implementation Notes:**

### Step 3.10 - Reset Runtime State [ ]

Do not mutate server counters from the adapter. Verify server lifecycle behavior for reset, restart, reload, disconnect, and replacement; reapplying a backend configuration initializes a new server counter. Leave dependency state to VS Code.

> **Implementation Notes:**

### Step 3.11 - Advertise Capabilities [ ]

Enable conditional, hit-conditional, and logpoint capabilities only under their prerequisites. Add no triggered-breakpoint capability.

> **Implementation Notes:**

### Step 3.12 - Update Documentation [ ]

Update `docs/debugging.md` and Step 3.11 of `debug-adapter-and-debug-views-plan.md` with syntax, ordering, lifecycle, interpolation, triggered activation, prerequisites, and limitations.

> **Implementation Notes:**

### Step 3.13 - Build and Run Unit Tests [ ]

```powershell
npm run compile
npm run test:unit
```

> **Implementation Notes:**

### Step 3.14 - Run Regression Tests [ ]

```powershell
npm run test:regression
```

Confirm ordinary breakpoints, instruction breakpoints, Step Over, watchpoints, pause, continue, and stop attribution remain unchanged.

> **Implementation Notes:**

### Step 3.15 - Run Real-Emulator Verification [ ]

Follow `test/features/README.md` and run:

```powershell
$env:V6EMUL = 'C:\path\to\v6emul.exe'
npm run test:feature:debug
```

Exercise true and false conditions, a hit threshold, combined condition and threshold, an interpolated logpoint, and a triggered dependent.

> **Implementation Notes:**

### Step 3.16 - Verify the Result Artifact [ ]

Confirm full success creates `test/features/debug-adapter/result.txt`. Failed or partial runs must not update it.

> **Implementation Notes:**

### Step 3.17 - Review Design Completion [ ]

Compare implementation with every acceptance criterion and checklist item. Mark completed steps and record deviations.

> **Implementation Notes:**

## 4. Expected Results

### 4.1 Register Condition

For `A == 0x10`, v6emul stops only when A is `0x10`; the adapter reports the canonical DAP ID.

### 4.2 Hit Count

For hit condition `5`, v6emul continues through matching visits 1 through 4 without a stop. Hit 5 and later matching visits produce a breakpoint stop for the adapter to process.

### 4.3 Combined Condition and Hit Count

For `A == 0` with hit condition `3`, only backend-qualified visits decrement the server counter. The third and later qualifying visits stop.

### 4.4 Logpoint

For `frame={HL}, color={A}`, the adapter emits one located Debug Console line and resumes without `stopped` or `continued`.

### 4.5 Triggered Breakpoint

VS Code initially sends only the trigger point. After a visible stop reports its stable ID, VS Code sends the dependent and the adapter installs it.

### 4.6 Stable Reconciliation

Unchanged requests preserve ID and count. Successful configuration changes preserve ID and reset count.

## 5. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Users expect unsupported hit-count syntax. | Document the decimal subset and reject other syntax. |
| Logpoint resume emits contradictory events. | Use a dedicated logpoint path and assert event order. |
| Adapter re-adds a breakpoint and resets its server counter unexpectedly. | Compare normalized backend configuration and avoid an add for unchanged or log-only changes. |
| Backend counter semantics differ from DAP expectations. | Test threshold, subsequent-stop, and condition-order semantics against v6emul. |
| Changes leave stale backend state. | Use acknowledged delete-then-add replacement. |
| Two requests configure one address differently. | Reject the conflict. |
| Step Over collides with a user breakpoint. | Never overwrite canonical user state. |
| Log interpolation uses inconsistent state. | Capture registers once per hit. |
| Malformed templates fail at runtime. | Parse and bound during configuration. |
| Log output floods the console. | Emit one event per qualifying hit without extra diagnostics. |
| A logpoint activates a dependent. | Only visible stopped events activate dependencies. |
| A dependent activates for the wrong trigger. | Preserve IDs and test exact hit attribution. |
| Nonstandard fields leak into DAP. | Keep `triggeredBy` in VS Code's model. |
| Dynamic capabilities arrive too late. | Verify VS Code and establish initialize-time policy. |

## 6. Validation Strategy

### 6.1 Unit Coverage

- Condition and hit parsers.
- Numeric, symbol, and width boundaries.
- Log literals, escapes, expressions, errors, size, and formatting.
- Backend payload construction.
- Address deduplication and conflicts.
- Complete reconciliation.
- Server-counter request payload and lifecycle.
- Logpoint event sequences.
- Resume and interpolation failures.
- Stable IDs and hit attribution.

### 6.2 Integration Coverage

- Mock IPC delete/add ordering.
- Server `counter` reaches zero only after matching visits.
- Pre-threshold visits create no stop record or DAP state event.
- Logpoints emit one located output and resume.
- Visible stops emit the canonical ID.
- VS Code submits a dependent only after its trigger stop.
- Reconnect and backend reapplication initialize a new server counter.

### 6.3 Regression Coverage

- Ordinary breakpoints stop on every hit.
- Source reconciliation remains ownership-safe.
- Instruction breakpoints remain functional.
- Stepping does not alter counters.
- Watchpoint and exception stops are not filtered.
- Existing Debug Console output remains unchanged.
- Triggered activation preserves unrelated breakpoints.
- Older backends do not advertise filtering features.

### 6.4 Performance Verification

- Failed register conditions remain backend-side.
- Runtime processing uses one address-map lookup.
- Pre-threshold visits create no adapter work, register refresh, stack sample, panel update, or UI event.
- Logpoints refresh registers only when interpolation needs them.
- Triggered dependents add no adapter work while pending.

## 7. Acceptance Criteria

1. VS Code exposes condition, hit-count, and logpoint editors under correct capabilities.
2. Exactly one adapter breakpoint exists per CPU address.
3. Every accepted condition maps exactly to one backend comparison.
4. Unsupported conditions and templates are never installed as ordinary stopping breakpoints.
5. Positive integer `N` is sent to v6emul as `counter` and performs the final action on qualifying hit `N` and later hits.
6. Combined conditions count only backend-qualified hits.
7. Pre-threshold visits produce neither an emulator stop record nor a DAP `stopped` or `continued` event.
8. A qualifying logpoint emits one located output event and no visible stop.
9. Interpolation errors remain non-stopping unless resume fails.
10. Failed automatic resume exposes the paused state.
11. The adapter does not count or resume pre-threshold visits.
12. Unchanged and log-message-only reconciliation preserves the server counter; backend condition or threshold changes initialize a new server counter.
13. Unknown or external breakpoint stops are never auto-resumed.
14. Triggered dependents remain absent until a visible trigger stop reports the canonical ID.
15. Pre-threshold visits and logpoints do not activate dependents.
16. No triggered-breakpoint capability or request field is invented.
17. Ordinary breakpoints, stepping, watchpoints, exceptions, and older backends do not regress.
18. Unit, regression, and real-emulator verification pass.
19. Documentation matches shipped behavior.

## 8. Relationship to Other Improvements

This feature completes the condition, hit-condition, logpoint, and triggered-breakpoint portion of Step 3.11 in `debug-adapter-and-debug-views-plan.md`. It depends on authoritative stop attribution for filtering and triggered activation. It does not change watchpoint conditions, page masks, or custom breakpoint UI.

## 9. Future Enhancements

- Exact-hit, relational, and modulo hit syntax.
- Richer logpoint expressions and formatting.
- Memory and flag expressions through a backend expression engine.
- A backend hit counter.
- Atomic breakpoint editing.
- Advanced page masks and custom UI.
- Persisted hit counts if a future contract requires them.

## 10. References

- Debug Adapter Protocol: capabilities, breakpoints, output, stopped, and continued events.
- VS Code debug model and session implementation for `triggeredBy` and `hitBreakpointIds` activation.
- `src/debug/adapter/v6-debug-adapter.ts`
- `src/emulator/protocol/debug-models.ts`
- `src/emulator/protocol/ipc-server-info.ts`
- `src/debug/utilities/symbol-expression.ts`
- `test/unit/debug/breakpoint-reconciliation.test.ts`
- `test/unit/debug/stop-record-adapter.test.ts`
- `test/features/README.md`
- `docs/debugging.md`
- `design/features/debug-adapter-and-debug-views-plan.md`
- `design/features/stop-record-extension-improvements.md`
- `design/features/v6emul-stop-record-design.md`

## 11. Implementation Checklist

- [ ] Read DAP breakpoint and event specifications.
- [ ] Verify the supported VS Code triggered-breakpoint request flow.
- [ ] Verify v6emul operand widths and comparison signedness.
- [ ] Define the one-breakpoint-per-address model.
- [ ] Add strict register-condition parsing.
- [ ] Add strict positive-decimal hit parsing.
- [ ] Add bounded log-template parsing and escaping.
- [ ] Define and test logpoint formatting.
- [ ] Add typed validation diagnostics.
- [ ] Extend the backend breakpoint builder.
- [ ] Apply translated conditions through `DEBUG_BREAKPOINT_ADD`.
- [ ] Reconcile condition, hit, and log-message changes.
- [ ] Preserve IDs across successful replacement.
- [ ] Preserve the server counter across unchanged and log-message-only requests.
- [ ] Verify server-counter lifecycle behavior at reset, restart, reload, disconnect, and backend replacement.
- [ ] Deduplicate compatible requests at one address.
- [ ] Reject conflicts at one address.
- [ ] Protect user breakpoints from Step Over collisions.
- [ ] Filter stops using one direct lookup.
- [ ] Send each hit condition as the backend `counter` field.
- [ ] Verify pre-threshold visits create no stop record or DAP state event.
- [ ] Emit one located output per qualifying logpoint.
- [ ] Resume logpoints without DAP state events.
- [ ] Keep interpolation failures non-stopping.
- [ ] Expose resume failures as visible stops.
- [ ] Leave unknown and external stops visible.
- [ ] Advertise conditional support under structured-breakpoint prerequisites.
- [ ] Advertise hit-condition support only with authoritative stops.
- [ ] Advertise logpoint support only with authoritative stops.
- [ ] Add no triggered-breakpoint capability or wire field.
- [ ] Verify all four workflows in an Extension Development Host.
- [ ] Verify pending dependents are absent initially.
- [ ] Verify trigger hit IDs cause dependent submission.
- [ ] Verify pre-threshold visits and logpoints do not activate dependents.
- [ ] Add parser and backend-payload unit tests.
- [ ] Add reconciliation and lifecycle tests.
- [ ] Add filtering and event-sequence tests.
- [ ] Add logpoint output and resume tests.
- [ ] Add triggered-activation integration tests.
- [ ] Add source and instruction integration coverage.
- [ ] Add regression coverage.
- [ ] Extend real-emulator feature verification.
- [ ] Update `docs/debugging.md`.
- [ ] Update Step 3.11 in `debug-adapter-and-debug-views-plan.md`.
- [ ] Run `npm run compile`.
- [ ] Run `npm run test:unit`.
- [ ] Run `npm run test:regression`.
- [ ] Run `npm run test:feature:debug` with `V6EMUL` configured.
- [ ] Verify `test/features/debug-adapter/result.txt` is created only after full success.
- [ ] Compare implementation with every acceptance criterion.
- [ ] Mark completed steps and record deviations.
