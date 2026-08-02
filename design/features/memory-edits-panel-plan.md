# V6 Memory Edits Panel Plan

**Status:** Proposed
**Date:** 2026-08-01
**Owners:** v6vscode and v6emul maintainers
**Related work:** `v6emul-menu-and-panels-plan.md`, `hex-viewer-panel-plan.md`, `debug-adapter-and-debug-views-plan.md`

## 1. Problem

### Current behavior

Hex Viewer can write one byte through `SET_BYTE_GLOBAL`, but the write is transient and is represented only in Hex Viewer's local cache. The extension does not retain the byte's original value, expose a list of edits, restore an edit, or make an edited value persistent when the emulated program writes to the same address.

The server exposes `DEBUG_MEMORY_EDIT_ADD`, `DEBUG_MEMORY_EDIT_DEL_ALL`, `DEBUG_MEMORY_EDIT_DEL`, `DEBUG_MEMORY_EDIT_GET`, and `DEBUG_MEMORY_EDIT_EXISTS`. A memory-edit record contains `globalAddr`, `value`, `readonly`, `active`, and `comment`. The extension does not currently use these requests when Hex Viewer changes a byte, so those changes are not represented as memory-edit entries.

### Desired behavior

Add a standalone **Memory Edits** editor panel using the same launcher, toggle command, open-state context key, and direct-tab-close synchronization as Display, Hex Viewer, Symbols, Ports, and Watchpoints.

The panel lists every byte edit made through Hex Viewer during the active emulator session. Each row shows:

- Address.
- Original value captured before the first edit at that address.
- Entered value requested by the user.
- Current value read from emulator memory.
- Read-only state, `On` or `Off`.

Users can filter rows by current byte value, edit the entered value and read-only state by double-clicking, copy values, navigate to Hex Viewer, restore the original byte, delete tracking, or delete and restore. Read-only maps directly to the server record's `readonly` field.

### Root cause

Hex Viewer sends `SET_BYTE_GLOBAL` directly and updates only its own cache. It does not capture the original value, retain a session list of changes, or create/update the corresponding server memory-edit record through `DEBUG_MEMORY_EDIT_ADD`.

## 2. Strategy

### Approach: shared client-side memory-edit service

Introduce one session-scoped `MemoryEditService` in the extension host and inject it into Hex Viewer and the new panel. Route every successful Hex Viewer byte edit through this service. The service captures the original byte once, retains entries created by this client, sends the existing server requests, reads current values, and maps typed memory spaces to global addresses.

Use a client model that augments the existing server record with the values needed by the panel:

```ts
interface ClientMemoryEditEntry {
    globalAddr: number;
    originalValue: number;
    enteredValue: number;
    currentValue?: number;
    readonly: boolean;
}
```

`originalValue` is the byte read immediately before this client first edits an address in the active session. `enteredValue` is the last value successfully written by this client. `currentValue` is refreshed through `GET_MEM`. `readonly` is sent to and read from the existing server memory-edit record.

### Why this works

- Hex Viewer and Memory Edits cannot diverge because both mutate through one service.
- The service exists for the emulator session rather than the panel lifetime, so closing the panel does not lose entries.
- The server supports one client; all entries created through this extension are already known locally.
- Existing named requests are sufficient for the single-client workflow.
- Typed `MemorySpace` conversion preserves Main RAM and all RAM-disk bank identities.
- Original values remain tied to the session in which they were observed, avoiding restoration into a different program after reconnect.

### Summary of changes

- Add the Memory Edits launcher/toggle contribution and standalone panel.
- Add typed models for the existing memory-edit request and response fields.
- Add a session-scoped `MemoryEditService` shared with Hex Viewer.
- Replace Hex Viewer's direct byte-write request with the shared service.
- Add search parsing, row editing, accessible context actions, refresh, and Hex Viewer navigation.
- Add focused protocol, service, panel, integration, and regression coverage.
- Update user and architecture documentation.

## 3. User Experience Contract

### 3.1 Surface and lifecycle

Add Memory Edits after Hex Viewer in the existing launcher:

```text
v6emul
  Panels
    Settings
    Display
    Hex Viewer
    Memory Edits
    Symbols
    Ports
    Watchpoints
```

Use:

- Command: `v6emul.toggleMemoryEdits`.
- Open-state context key: `v6emul.memoryEditsOpen`.
- Webview panel ID: `v6.memoryEdits`.
- Tab title: `Memory Edits`.
- `ViewColumn.Beside` and `retainContextWhenHidden: true`.

Maintain at most one panel instance. `open()` reveals an existing panel, the toggle closes an open panel, and direct tab disposal clears launcher/context state. Closing the panel stops UI refresh work but does not delete edits or change their read-only state.

Session states are:

- **No session:** empty list and `No active emulator session`.
- **Synchronizing:** retain the previous same-session snapshot and disable mutations.
- **Ready/paused:** current session rows.
- **Running:** current values refresh once per second while visible when coherent reads are supported.
- **Unsupported backend:** identify any missing required memory-edit request.
- **Read failure:** retain session rows, mark current values stale, and expose Refresh.
- **Disconnected:** clear entries and original values; never carry them into another emulator session.

### 3.2 Layout and values

Use one unframed tool surface:

1. A full-width search input.
2. A compact status/result-count line.
3. A table filling the remaining panel height.

Columns are ordered exactly:

| Column | Format | Editing |
|---|---|---|
| Address | `0xNNNNNN`; tooltip includes `Main RAM` or `RAM Disk D / Bank B` and local `0xNNNN` | Read-only |
| Original | `0xNN` | Read-only |
| Entered | `0xNN` | Double-click text input |
| Current | `0xNN`, or `--` when unavailable | Read-only |
| Read-only | `On` or `Off` with an accessible state | Double-click toggle/checkbox |

Sort rows by ascending global address. Use a sticky header and stable compact columns; allow horizontal scrolling at narrow widths instead of converting rows to cards. Preserve focus and selection by global address after snapshot replacement.

Update a row only after each required server request succeeds. Values are uppercase and zero-padded. Render text with `textContent` or form values, never `innerHTML`.

### 3.3 Search

Search is a byte-value filter over the **Current** column. An empty input shows all entries. Accepted syntax is:

- Decimal: `0` through `255`.
- Dollar hexadecimal: `$00` through `$FF`.
- Prefix hexadecimal: `0x00` through `0xFF`.
- Suffix hexadecimal: `00h` through `FFh`.

Bare digits are decimal. Whitespace around the value is allowed. Reject fractions, signs, expressions, multiple values, malformed digits, and values outside `0..255`.

Filtering updates on every input event without requiring Enter. Invalid input retains the last valid result set, applies VS Code error styling, and sends no emulator request. Search is local to the panel snapshot and never drives memory reads.

The search tooltip must state the matching field, decimal rule, accepted hexadecimal forms, valid range, and examples. Use this exact semantic content:

```text
Filter by current byte value. Decimal: 0..255. Hex: $NN, 0xNN, or NNh. Bare digits are decimal. Examples: 42, $2A, 0x2A, 2Ah. Clear the field to show all edits.
```

Persist only the last valid search text in workspace state. Do not persist edit rows or original/current bytes.

### 3.4 Creating and updating entries

A Hex Viewer edit follows one service transaction:

1. Validate session, memory space, address, expression, and byte range in the extension host.
2. If the address is not tracked, read its current byte and retain it as `originalValue`.
3. Write `enteredValue` through `SET_BYTE_GLOBAL`.
4. Create or replace the server record through `DEBUG_MEMORY_EDIT_ADD` with `readonly: false`, `active: true`, and an empty comment.
5. Publish the client entry consumed by both panels; Hex Viewer updates its cache only after both requests succeed.

Repeated edits at the same global address retain the first original value and replace the entered value. There is one row per global address.

Double-clicking Entered opens an inline editor accepting the same byte literal forms as search. `Enter` or focus loss submits; `Escape` cancels. Invalid input keeps the editor open with an associated error and sends no mutation.

Double-clicking Read-only toggles a checkbox/control. Send `DEBUG_MEMORY_EDIT_ADD` with the same address, value, active state, and comment, changing only `readonly`. Toggling the field does not itself change the current byte. Webview messages carry only the global address and candidate state; the host resolves the local entry and builds the complete server record.

### 3.5 Read-only semantics

Read-only `On` maps to server field `readonly: true`; Read-only `Off` maps to `readonly: false`. The extension does not implement this behavior by periodically rewriting memory.

When Entered is changed, send `SET_BYTE_GLOBAL` with the new value and then replace the server record through `DEBUG_MEMORY_EDIT_ADD`, preserving the current read-only state. If either request fails, refresh the current byte and keep the entry visible with an operation error.

### 3.6 Context menu

Right-clicking a row, pressing the Context Menu key, or pressing `Shift+F10` opens an accessible custom DOM menu in this order:

1. **Copy Original Value**
2. **Copy Entered Value**
3. **Copy Current Value**
4. **Find in Hex Viewer**
5. **Restore Original**
6. **Delete Entry**
7. **Delete and Restore**

Copy actions write canonical `0xNN` text through `vscode.env.clipboard.writeText`. Copy Current Value is disabled when the current byte is unavailable.

**Find in Hex Viewer** converts the global address with `globalAddressMemoryLocation`, calls `HexViewerProvider.revealRange(space, offset, offset)`, then opens/reveals Hex Viewer. The handoff must work while Hex Viewer is closed or not ready and must select the correct RAM-disk bank.

**Restore Original** writes `originalValue` through `SET_BYTE_GLOBAL`, sets Read-only to `Off` through `DEBUG_MEMORY_EDIT_ADD`, and retains the row and its entered value.

**Delete Entry** removes the server edit record and the panel row but leaves the current memory byte unchanged.

**Delete and Restore** writes `originalValue` through `SET_BYTE_GLOBAL`, then removes the server record through `DEBUG_MEMORY_EDIT_DEL`, then removes the local row. If restoration fails, retain the entry and report the failure. If deletion fails after restoration, retain the entry, refresh its current value, and report the deletion failure.

Close the menu on action, Escape, outside click, scroll, edit start, snapshot replacement, session change, panel hide, or disposal. Return focus to the row when it still exists, otherwise to the table.

## 4. Architecture and Protocol

```mermaid
flowchart LR
    Launcher[v6emul launcher] --> Toggle[Memory Edits toggle]
    Toggle --> Panel[MemoryEditsPanel]
    Hex[HexViewerProvider] --> Service[MemoryEditService]
    Panel --> Service
    Service --> Memory[MemoryService]
    Service --> Client[IpcClient]
    Service --> Lifecycle[EmulatorLifecycle]
    Service --> Hex
    Client --> Emulator[v6emul memory-edit requests]
```

### 4.1 Ownership

**MemoryEditService** owns session generation, original values, local entries, serialized request sequences, current-value reads, and change events. It exposes operations such as `apply`, `setReadonly`, `restore`, `delete`, `deleteAndRestore`, `refresh`, and `snapshot`.

**MemoryEditsPanel** owns `WebviewPanel` lifecycle, visibility-based refresh, persisted search text, validated host/webview messages, clipboard access, and Hex Viewer handoff. It never invokes emulator IPC directly.

**HexViewerProvider** continues to own grid rendering, expression evaluation, and visible memory caching, but delegates accepted writes to `MemoryEditService`. Service change events update or invalidate the matching Hex Viewer cache byte so both panels show the successful result.

**v6emul** is authoritative for the stored memory-edit record and current memory byte. The extension owns the session list of addresses it edited and the original value observed before its first edit at each address.

### 4.2 Server Interface Requirements

#### Problem: Register and manage Hex Viewer edits

The client must record each successful Hex Viewer byte change, show its original, entered, and current values, expose the server's Read-only field, and support restore and delete actions. Addresses must cover Main RAM and every RAM-disk bank.

#### Current solution from server

The server exposes the required primitives:

- `DEBUG_MEMORY_EDIT_ADD`: accepts the legacy record fields `globalAddr`, `value`, `readonly`, `active`, and `comment`; address and value are formatted hexadecimal strings rather than numeric wire values.
- `DEBUG_MEMORY_EDIT_DEL_ALL`: deletes all records.
- `DEBUG_MEMORY_EDIT_DEL`: deletes the record at one supplied address.
- `DEBUG_MEMORY_EDIT_GET`: returns the record at one supplied address.
- `DEBUG_MEMORY_EDIT_EXISTS`: reports whether one supplied address has a record.
- `GET_MEM`: reads current bytes.
- `SET_BYTE_GLOBAL`: writes one current byte.

The server interface is sufficient because it accepts one client and the extension knows every address it adds during the active session. Restore operations can be composed from `SET_BYTE_GLOBAL`, `DEBUG_MEMORY_EDIT_ADD`, and `DEBUG_MEMORY_EDIT_DEL`.

It is not enough by itself because Hex Viewer does not call the memory-edit requests or retain the additional Original and Current values required by the panel. The missing work is in the extension.

#### Needed: I need this; I recommend this

No new server request is required. Use the existing request names and record shape:

```ts
interface ServerMemoryEditRecord {
    globalAddr: string; // canonical 0xNNNNNN
    value: string;      // canonical 0xNN
    readonly: boolean;
    active: boolean;
    comment: string;
}
```

I recommend documenting and testing these existing client-visible contracts:

- `DEBUG_MEMORY_EDIT_ADD` creates or replaces the record identified by `globalAddr` and accepts addresses across the complete global-memory range.
- `DEBUG_MEMORY_EDIT_GET`, `DEBUG_MEMORY_EDIT_EXISTS`, and `DEBUG_MEMORY_EDIT_DEL` use `{ addr }`, where `addr` is a numeric global address across the same range.
- `DEBUG_MEMORY_EDIT_GET` returns `{ data: ServerMemoryEditRecord }` when the record exists.
- `DEBUG_MEMORY_EDIT_EXISTS` returns `{ data: boolean }`.
- Add and delete requests use the standard IPC success/error envelope; no additional response data is needed.
- `GET_MEM` and `SET_BYTE_GLOBAL` accept the same global-address range.

The only server-side dependency is confirming that every memory-edit request accepts full global addresses, not only Main RAM addresses. If that contract already holds, the feature requires no server-interface change.

Suggested extension layout:

```text
src/
  debug/
    memory-edits/
      memory-edit-model.ts
      memory-edit-codec.ts
      memory-edit-service.ts
    views/
      memory-edits-panel.ts
      memory-edits-messages.ts
      memory-edits-query.ts
      assets/
        memory-edits.css
        memory-edits.js
```

## 5. Implementation Steps

### Step 5.1 - Verify the existing server contract [ ]

Confirm the named memory-edit requests and their existing fields, responses, replacement behavior, and full global-address range. Add focused server-interface tests only where that observable contract is not already covered.

> **Design Notes:** Use the existing server requests without extending the protocol.
>
> **Implementation Notes:**

### Step 5.2 - Add extension protocol models and validation [ ]

Add typed request/response models and formatting/parsing helpers for the existing record. Detect required request support through the names advertised by `GET_SERVER_INFO`. Cover malformed records, byte/global bounds, and missing requests.

> **Implementation Notes:**

### Step 5.3 - Implement MemoryEditService [ ]

Add session lifecycle handling, first-original capture, local snapshots, serialized request sequences, current-value refresh, and change events. Group adjacent current-value reads into bounded `GET_MEM` ranges instead of issuing one request per row. Reject stale responses after session changes.

> **Implementation Notes:**

### Step 5.4 - Route Hex Viewer writes through the service [ ]

Inject the shared service into Hex Viewer, preserve existing expression validation, call `SET_BYTE_GLOBAL` and `DEBUG_MEMORY_EDIT_ADD`, and keep the Hex Viewer cache synchronized after success. Add regression coverage proving repeated edits retain the first original value.

> **Implementation Notes:**

### Step 5.5 - Add launcher and panel lifecycle [ ]

Add command/context IDs, manifest command, launcher entry after Hex Viewer, extension composition, toggle registration, direct-close synchronization, and a minimal panel with all session states.

> **Implementation Notes:**

### Step 5.6 - Implement search and table rendering [ ]

Add the pure byte-query parser, exact tooltip, workspace search persistence, current-value filtering, deterministic row sorting, stable columns, keyboard focus, stale/unavailable rendering, and visible-only live refresh.

> **Implementation Notes:**

### Step 5.7 - Implement inline edits and Read-only [ ]

Add double-click Entered and Read-only controls, Enter/blur/Escape behavior, immediate webview validation, authoritative host validation, disabled in-flight actions, server request handling, and error recovery.

> **Implementation Notes:**

### Step 5.8 - Implement row context actions [ ]

Add the seven ordered accessible menu actions, canonical clipboard writes, typed Hex Viewer navigation, restore/delete semantics, keyboard navigation, focus restoration, and mutation failure handling.

> **Implementation Notes:**

### Step 5.9 - Update documentation and regression expectations [ ]

Update `README.md`, `docs/architecture.md`, `docs/commands.md`, `docs/debugging.md`, `docs/emulator.md`, and the panel inventory in `v6emul-menu-and-panels-plan.md`.

> **Implementation Notes:**

### Step 5.10 - Build and run automated verification [ ]

Run compile, lint, focused memory-edit tests, the complete unit suite, and regression suite. Fix only failures caused by this feature.

```powershell
npm run compile
npm run lint
npm run test:unit -- --grep "Memory Edit"
npm run test:unit
npm run test:regression
```

> **Implementation Notes:**

### Step 5.11 - Complete Extension Development Host verification [ ]

Exercise panel toggling/direct close, Main RAM and RAM-disk edits, search forms and errors, every context action, Read-only On/Off, reset/restart, disconnect, unsupported servers, and closed-Hex-Viewer navigation.

> **Implementation Notes:**

## 6. Test Plan

### Unit and service tests

- Parse decimal and `$NN`, `0xNN`, and `NNh` byte forms at boundaries; reject malformed/out-of-range input.
- Filter only by current value; empty input shows all rows and invalid input retains the prior valid result set.
- First edit captures original once; later edits at the same global address preserve it.
- Main RAM and every RAM-disk bank map to unique global addresses and back.
- Apply/update, Read-only toggle, restore, delete, and delete-and-restore send the expected existing request sequences.
- Failed writes do not create entries or change successful local values.
- Restore retains entered value and row while turning Read-only off.
- Delete leaves current memory unchanged; delete-and-restore writes original before removing the row.
- Stale responses from a previous session are discarded and disconnect clears original values.
- Current-value refresh coalesces adjacent addresses and respects negotiated read limits.
- Malformed `DEBUG_MEMORY_EDIT_GET` records and out-of-range addresses/values are rejected at the client boundary.

### Panel and integration tests

- Toggle/open/direct-dispose operations synchronize `v6emul.memoryEditsOpen` and launcher state.
- Memory Edits appears immediately after Hex Viewer in launcher/manifest tests.
- Hidden/closed panels stop current-value polling without changing server Read-only records.
- Hex Viewer edits create rows and successful value changes update both surfaces.
- Double-click controls commit/cancel correctly and expose accessible errors.
- Clipboard actions write exact canonical values.
- Find in Hex Viewer opens a closed panel, selects the correct bank, and reveals one address.
- Context menu ordering, disabled states, keyboard operation, closure, and focus restoration match the contract.
- Unsupported/no-session/read-failure states never send invalid mutations.

### Server interface checks

- `DEBUG_MEMORY_EDIT_ADD` creates or replaces the record at a known global address.
- `DEBUG_MEMORY_EDIT_GET` returns the expected record for that known address.
- `DEBUG_MEMORY_EDIT_EXISTS` reflects add and delete operations.
- `DEBUG_MEMORY_EDIT_DEL` and `DEBUG_MEMORY_EDIT_DEL_ALL` remove the expected records.
- All memory-edit requests accept Main RAM and RAM-disk global addresses.
- `GET_MEM` and `SET_BYTE_GLOBAL` accept the same global-address range used by memory-edit records.

### Manual acceptance checks

1. Open the v6emul launcher and verify Memory Edits toggles like the existing panels.
2. Edit a Main RAM byte in Hex Viewer and verify original, entered, and current values.
3. Edit the same byte again and verify original remains unchanged.
4. Repeat in at least two RAM-disk banks and verify addresses do not collide.
5. Exercise decimal and all three hexadecimal search forms and inspect the full tooltip.
6. Double-click Entered and Read-only with mouse and keyboard.
7. With Read-only off, let the program overwrite the byte and verify Current changes.
8. With Read-only on, let the program attempt to overwrite the byte and verify the server's existing Read-only behavior while the panel is hidden.
9. Exercise every context action, including Find in Hex Viewer while Hex Viewer is closed.
10. Verify Restore Original retains the row, Delete Entry leaves memory unchanged, and Delete and Restore removes the row only after restoration.
11. Reset/restart within the session, then disconnect and start a different program; verify session clearing rules.
12. Check narrow/wide editor columns, high-contrast theme, and keyboard-only operation.

## 7. Expected Results

### Centralized edit history

Every successful Hex Viewer byte edit becomes a traceable session entry with the first observed value, requested value, and live result.

### Read-only memory edits

The panel exposes the server's existing Read-only state directly and retains that state when the panel is hidden or closed.

### Reversible experimentation

Users can temporarily restore, stop tracking without changing memory, or remove and restore without guessing the original byte.

### Bank-correct navigation

Global addresses remain unambiguous across Main RAM and 32 RAM-disk banks, and any row can open Hex Viewer at the exact byte.

## 8. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| A multi-request operation partially fails | Keep the row, refresh Current through `GET_MEM`, and report which action failed. |
| Original values become invalid after reconnect or loading another program | Keep originals session-scoped and clear them on disconnect/session generation change. |
| Large edit collections cause excessive reads | Group adjacent addresses into bounded bulk reads and poll only while visible. |
| Hex Viewer and panel caches disagree | Route all writes through one service and notify Hex Viewer after successful requests. |
| Restore fails before deletion | Send `SET_BYTE_GLOBAL` first and do not send `DEBUG_MEMORY_EDIT_DEL` when restoration fails. |
| Search syntax is mistaken for address search | Label and tooltip it explicitly as a current-byte-value filter and keep parsing in a focused pure module. |

## 9. Implementation Checklist

- [ ] Verify the existing named memory-edit requests and record fields.
- [ ] Verify every memory-edit request accepts Main RAM and RAM-disk global addresses.
- [ ] Add focused server-interface coverage only for missing observable contract tests.
- [ ] Add extension models and parsers for the existing memory-edit record.
- [ ] Implement session-scoped `MemoryEditService` with serialized request sequences.
- [ ] Capture the original byte once before the first successful edit at each address.
- [ ] Clear entries/originals on session end and reject stale asynchronous results.
- [ ] Route all Hex Viewer byte edits through `MemoryEditService`.
- [ ] Synchronize successful changes back into Hex Viewer cache/rendering.
- [ ] Add `v6emul.toggleMemoryEdits` and `v6emul.memoryEditsOpen`.
- [ ] Add Memory Edits after Hex Viewer in the launcher and Command Palette.
- [ ] Implement one standalone `WebviewPanel` with toggle/reveal/direct-close synchronization.
- [ ] Implement no-session, synchronizing, ready, running, unsupported, stale, and disconnected states.
- [ ] Render Address, Original, Entered, Current, and Read-only columns in global-address order.
- [ ] Add the current-value byte filter with decimal, `$NN`, `0xNN`, and `NNh` syntax.
- [ ] Add the required search tooltip, validation state, and workspace search persistence.
- [ ] Implement double-click Entered editing with Enter/blur/Escape behavior.
- [ ] Implement double-click Read-only toggling through `DEBUG_MEMORY_EDIT_ADD`.
- [ ] Implement Copy Original, Entered, and Current through the extension-host clipboard.
- [ ] Implement Find in Hex Viewer with typed bank/address navigation and closed-panel handoff.
- [ ] Implement Restore Original while retaining the row and entered value.
- [ ] Implement Delete Entry without changing current memory.
- [ ] Implement Delete and Restore through `SET_BYTE_GLOBAL`, then `DEBUG_MEMORY_EDIT_DEL`.
- [ ] Add accessible mouse/keyboard context-menu behavior and focus restoration.
- [ ] Stop UI polling while hidden without changing server Read-only records.
- [ ] Add focused parser, service, Hex Viewer integration, panel lifecycle, and action tests.
- [ ] Update manifest/launcher regression tests and user/architecture documentation.
- [ ] Run compile, lint, unit, and regression suites.
- [ ] Complete Extension Development Host manual acceptance checks.
