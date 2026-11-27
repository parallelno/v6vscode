# Scripts and Lua

The **Scripts** panel manages Lua scripts owned by the `v6emul` process. Scripts can inspect CPU registers and memory, request a break, and draw retained text and rectangle overlays on the emulator **Display**. They cannot write emulated memory, access I/O ports, or change the framebuffer.

The intrinsic set and its validation are implemented in `v6emul` (`libs/v6core/include/core/scripts.h`, `libs/v6core/src/scripts.cpp`). This page documents the behavior exposed through the VS Code extension, including the differences from the older Devector README.

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Opening the panel](#opening-the-panel)
- [Panel reference](#panel-reference)
- [Built-in help](#built-in-help)
- [Adding and validating scripts](#adding-and-validating-scripts)
- [Compilation and runtime states](#compilation-and-runtime-states)
- [Ownership and lifetime](#ownership-and-lifetime)
- [Execution model](#execution-model)
- [Intrinsic reference](#intrinsic-reference)
- [Coordinates, color, and clipping](#coordinates-color-and-clipping)
- [Limits](#limits)
- [Examples](#examples)
- [Common pitfalls](#common-pitfalls)
- [Performance checklist](#performance-checklist)
- [Troubleshooting](#troubleshooting)
- [Related documentation](#related-documentation)

## Requirements

- An active `v6emul` session whose `GET_SERVER_INFO` advertises script schema 1 and commands `84..88` and `105..109`.
- For overlays, script-overlay schema 1, `scriptOverlayColorFormat: "RRGGBBAA"`, and command `110` (`DEBUG_SCRIPT_OVERLAY_GET`). The drawing intrinsics still exist on servers without overlay schema 1; items are retained by the emulator but no connected Display requests them.
- Script files are read by the emulator, not by VS Code. The path must be absolute and server-local. The normal case is the same machine, so use a normal absolute path such as `C:/work/demo/hud.lua` or `/home/me/demo/hud.lua`.
- Automatic per-instruction execution requires the emulator debugger to be attached. v6vscode attaches it for **Run Project**, debug launches, and attach sessions, so enabled scripts run automatically in all normal VS Code sessions. An external client that connects without attaching the debugger can still use **Run Once**, but enabled scripts will not run automatically.

In a project-owned session, the panel saves each script's name, path, and Activity setting to `run.scripts` in the launching `*.project.json`. A new session restores those entries, even if the Scripts panel is closed. Paths are stored relative to the project file when possible. Keep the `.lua` files: their source is not embedded. Emulator IDs, compilation/runtime state, Lua globals, and overlays are not saved. Borrowed attach sessions have no launching project and do not change project settings.

## Quick start

Create `hud.lua`:

```lua
-- Runs after every retired instruction while the debugger is attached.
-- Throttle to roughly 4 updates per second at the 3 MHz Vector-06c clock.
local cc = GetCC()
if cc - (hudLastCC or 0) < 750000 then return end
hudLastCC = cc

DrawText(1, string.format("PC %04X", GetPC()), 0, 0, 0xFFFFFFFF, false)
```

Open **Scripts**, choose **Add**, set **Name** to `HUD`, set **Path** to the absolute path of `hud.lua`, leave **Activity** enabled, and submit. The row shows a check mark when compilation succeeds. Open **Display** to see the overlay.

## Opening the panel

Use any of:

- Command Palette: **v6emul: Scripts**
- The `v6emul` Activity Bar container
- **View > Open View... > v6emul**

The panel uses the shared session connection. Without a session it shows `No active emulator session`; with an older emulator it shows that script schema 1 is not supported.

## Panel reference

| Column | Meaning |
|---|---|
| **Compilation** | `✓` when the file compiled. `✕` for a compilation error or a runtime error; hover the cell for the full message. The row uses the error foreground color. |
| **Activity** | Requests automatic execution. This is the emulator-owned `active` flag, not a file property. Turning it off also removes that script's overlays. |
| **Name** | User label for the script. Filtering uses this column. |
| **Path** | Absolute emulator-local path. VS Code displays and sends generic `/` separators. |

The title menu and the row context menu provide:

| Action | Behavior |
|---|---|
| **Copy** | Copies the clicked field: name, path, `Enabled`/`Disabled`, or the compilation/runtime error (or `Compiled Successfully`). |
| **Add** | Opens an inline draft row. Name and path are required; Activity defaults to enabled. The new record is compiled immediately and, if compilation succeeds and Activity is on, runs on the next retired instruction. |
| **Compile** | Re-reads the file and replaces the compiled chunk. Resets the runtime state to `never_run` and clears the runtime error. Does not remove existing overlays. |
| **Run Once** | Executes the compiled chunk once against the current CPU/memory state. Works for inactive scripts. Does not step the CPU. |
| **Disable** | Sets Activity off and removes that script's overlays. |
| **Disable All** | Confirms, then disables every active script and removes all overlays. |
| **Delete** | Removes the record and its overlays. **The `.lua` file is not deleted.** |
| **Delete All** | Confirms, then removes every record and overlay. **Files are not deleted.** |
| **Refresh** | Re-fetches the complete ID-ordered collection. The visible panel also polls the lightweight update revision once per second. |

Double-click **Name** or **Path** to edit inline. Enter submits; Escape cancels. The Activity checkbox toggles immediately.

While the emulator is running, mutations are gated independently from execution. Add, Edit, Compile, Activity changes, Disable, Disable All, Delete, and Delete All require the server's `scriptMutationsWhileRunning` capability; **Run Once** requires `scriptRunOnceWhileRunning`. Current `v6emul` advertises both. When a capability is absent, pause the emulator first. Automatic execution of already-enabled scripts is not affected by these gates.

The filter is case-insensitive. A query without `*` is a substring match; a query containing `*` is a full-name glob (`*` matches any run of characters). The query is limited to 256 characters and is restored per workspace.

## Built-in help

- **Examples** opens a searchable list. Hover or use the arrow keys to preview help. Click an example or press Enter to copy its code and open an **OK / Cancel** confirmation with the full destination path. **OK** saves the `.lua` file beside the project's executable and adds it with Activity off. **Cancel** leaves the code on the clipboard without creating a file. Existing files are not overwritten.
- **Intrinsics** lists the emulator functions by category. Search by name, category, or help text. Hover or focus an item to preview it; click or press Enter to copy a Lua call. Esc closes either list.
- **Help** opens this guide in your browser. The built-in lists work without an emulator connection; saving and adding an example requires a supported project session in a trusted workspace.

## Adding and validating scripts

- **Name** must not be empty and must fit the server-advertised UTF-8 byte limit.
- **Path** must be absolute. `C:/...`, `/...`, and UNC `//server/share/...` forms are accepted. Backslashes are normalized to `/` before sending.
- The source must be a readable regular file, no larger than `maxSourceBytes` (1 MiB in v6emul), valid UTF-8, and free of NUL bytes.
- A missing or invalid file does **not** reject the record. It is added with a compilation error, and the requested Activity state is retained. Fix the file and use **Compile**.
- The emulator allocates stable script IDs. IDs are never reused, even after deletion, and the collection is limited to 256 records.
- Editing only Name or Activity does not recompile. Changing Path recompiles. Saving new contents to the same path does **not** recompile: press **Compile** to reload the file.

## Compilation and runtime states

| State | Meaning | Effect |
|---|---|---|
| `compiled` | The file was loaded successfully. | Eligible to run. |
| Compilation error | Missing/unreadable file, oversized source, invalid UTF-8/NUL, or a Lua syntax error. | The script cannot run until compiled successfully. |
| `never_run` | Compiled but not executed since the last compile. | Eligible to run. |
| `succeeded` | The last execution completed normally (including a `Break()` request). | Eligible to run. |
| Runtime error | The last execution raised a Lua error, exceeded the execution budget, or exceeded an overlay limit. | Automatic execution is skipped until a successful **Compile** or **Run Once**. |

**Run Once** requires a compiled script and reports a runtime error in the row. A successful Run Once clears the runtime error and allows automatic execution again. `Break()` is not an error: it sets a stop request, and the script still completes normally.

## Ownership and lifetime

Scripts, IDs, Activity flags, compilation state, runtime state, and overlays belong to the emulator process:

- They survive debugger detach/attach, CPU reset, emulator restart, ROM loading, and TCP reconnect while the same emulator process lives.
- When the emulator process exits, live state is lost. A new project-owned session restores the saved entries with fresh IDs and compiles their current source files.
- Deleting a script does not delete its file. Delete All does not delete any files.
- The Lua state is shared by all scripts and is not reset by Compile, Delete, or Delete All. Global variables therefore survive recompiles and deletions until the process exits.

## Execution model

### When scripts run

While the debugger is attached, `v6emul` calls each eligible script after every retired CPU instruction. A script is eligible when it is **active**, **compiled**, and its last runtime state is not an error. v6vscode attaches the debugger for **Run Project**, debug launches, and attach sessions, so enabled scripts run in all normal VS Code sessions. A session created by another client that does not attach the debugger only supports **Run Once**.

This is a per-instruction hook, not a per-frame hook. At the 3 MHz Vector-06c clock a script body can execute millions of times per second, so it must be cheap. Gate expensive work with `GetPC()` or `GetCC()`.

### PC and opcode timing

The script runs **after** the instruction retired and **before** the next instruction starts:

- `GetPC()` is the address of the **next** instruction. For a jump or call it is the target; otherwise it is the following address. A check such as `if GetPC() ~= 0x05CB then return end` fires when the next instruction is at `0x05CB`.
- `GetOpcode()` is the first byte of the instruction that **just executed**, not the instruction at `GetPC()`.
- `GetCC()` already includes the cycles of the retired instruction.
- `GetMachineCycles()` is a low-level machine-cycle index. After an instruction retires it has normally wrapped to `0`; use `GetCC()` for timing.

### Order and shared state

- All scripts share one Lua state. Global variables persist across executions and are visible to every script, including after Compile, Delete, and Delete All.
- `local` variables are recreated on every run.
- The execution order of scripts is unspecified. Do not rely on one script running before another. Overlay draw order is deterministic and is described below.
- Namespace globals per script, for example `hud_last_cc` instead of `last`, to avoid collisions.

### Lua environment

`v6emul` uses Lua 5.1-compatible LuaJIT with the JIT engine disabled. The standard `string`, `table`, `math`, `coroutine`, `bit`, and `jit` libraries are available, along with `print`, `error`, `assert`, `pcall`, and `xpcall`.

The following globals are removed: `io`, `os`, `package`, `require`, `loadfile`, and `dofile`. There is no file, clock, network, or module access. Use `GetCC()` for timing and `math.randomseed(GetCC())` if you need a seed.

`debug` and `load`/`loadstring` remain reachable as part of the standard library. Treat them as implementation details: `debug.sethook` can remove the execution-budget hook, and dynamically loaded code is not sandboxed beyond the same removed globals. Do not use them in normal scripts.

### Execution budget and errors

Each script execution is limited to **100,000 Lua VM instructions** and **25 ms** of wall-clock time. Exceeding either limit raises `Script execution budget exceeded`, records a runtime error, and stops automatic execution of that script until a successful Compile or Run Once.

Lua errors (`error(...)`, failed `assert`, invalid intrinsic arguments, overlay-limit errors) behave the same way. An unhandled error does not stop the emulator; it disables that script's automatic execution. Use `pcall` only if you want the script to keep running after a recoverable failure.

### Break requests

`Break()` sets a stop request. It does **not** abort the Lua chunk: the rest of the script runs, then the emulator stops after the current instruction completes. The stop reason is `script` and identifies the requesting script ID. In the Scripts panel, **Run Once** reports `Script N requested a break`.

### `print` output

`print` writes to the emulator process stdout. In VS Code it appears in the **v6emul** Output channel, not the Debug Console. Avoid printing on every instruction; it floods the channel and slows emulation. Guard diagnostics with a PC or cycle check.

## Intrinsic reference

All intrinsics are global functions. They return Lua numbers, booleans, or strings; there are no objects, tables, or userdata to manage.

### CPU state

| Intrinsic | Returns | Notes |
|---|---|---|
| `GetCC()` | number | 64-bit clock-cycle counter since CPU reset. It includes the just-retired instruction. Exact in a Lua number up to 2^53 cycles. |
| `GetPC()` | 0..65535 | Address of the **next** instruction (see [PC and opcode timing](#pc-and-opcode-timing)). |
| `GetSP()` | 0..65535 | Stack pointer. |
| `GetPSW()` | 0..65535 | The AF word: `A` in the high byte, flags in the low byte. |
| `GetBC()`, `GetDE()`, `GetHL()` | 0..65535 | Register-pair word. `B`/`D`/`H` is the high byte and `C`/`E`/`L` the low byte. |
| `GetA()` | 0..255 | Accumulator. |
| `GetF()` | 0..255 | Flags byte. |
| `GetB()`, `GetC()`, `GetD()`, `GetE()`, `GetH()`, `GetL()` | 0..255 | Individual registers. |
| `GetFlagS()`, `GetFlagZ()`, `GetFlagAC()`, `GetFlagP()`, `GetFlagC()` | boolean | Sign, zero, auxiliary carry, parity, and carry flags. |
| `GetINTE()` | boolean | Interrupt enable. |
| `GetIFF()` | boolean | 50 Hz interrupt flip-flop: set by the timer, cleared when `RST7` is taken. |
| `GetHLTA()` | boolean | HLT-active latch. Older Devector documentation calls this a temporary HL register; it is not a register. |
| `GetMachineCycles()` | 0..15 | Machine-cycle index of the CPU. After an instruction retires it has normally wrapped to `0`; use `GetCC()` for elapsed time. |
| `GetOpcode()` | 0..255 | First byte of the instruction that just executed. For an injected `RST7` interrupt this can be `0xFF`. |

Register and flag reads are C-closure calls. Store the results in locals instead of calling the same getter repeatedly.

### Memory

| Intrinsic | Returns | Notes |
|---|---|---|
| `GetByteGlobal(address)` | 0..255 | Reads the emulator's physical global RAM at `address`. See the address map below. |
| `GetLabelAddr(name)` | address or negative | Returns the global address of a debugger label, or a negative value when the exact, case-sensitive name is unknown. |

`GetByteGlobal` addresses:

| Range | Contents |
|---|---|
| `0x00000..0x0FFFF` | Main RAM (64 KiB). With no RAM-disk mapping active, these global addresses equal CPU addresses. |
| `0x10000 + bank * 0x10000` | RAM-disk bank `bank` (`0..31`), 64 KiB each, ending at `0x20FFFF`. |

`GetByteGlobal` reads the backing RAM directly and ignores the current RAM-disk mapping. You can inspect any bank even when it is not mapped into the CPU address space. Use the **Hex Viewer** or **Memory Display** to confirm a bank's global range.

There is no script intrinsic for writing memory, reading I/O ports, or reading the framebuffer. Use **Memory Edits**, **Watchpoints**, and **Hex Viewer** for those tasks.

`GetByteGlobal` has no Lua-level range check. Addresses outside `0x00000..0x20FFFF` are invalid and may terminate the emulator; validate the address in Lua if it comes from program data.

`GetLabelAddr` performs an exact, case-sensitive, linear search over the emulator's label table and returns `-1` when the name is not present. Current `v6emul` builds do not populate that table from the project's ELF/DWARF metadata in the VS Code workflow, so expect `-1` in practice. Always keep a numeric fallback.

### Execution control

| Intrinsic | Returns | Notes |
|---|---|---|
| `Break()` | none | Requests a debugger stop after the current instruction. The rest of the Lua chunk still runs. |

### Overlay drawing

```lua
DrawText(id, text, x, y [, color [, vectorScreenCoords]])
DrawRect(id, x, y, width, height [, filled [, color [, vectorScreenCoords]]])
```

| Argument | Type | Rules |
|---|---|---|
| `id` | integer | `0..2147483647`. Identifies the item within the current script. Must be a whole number; `1.5` and `"1"` are rejected. |
| `text` | string | Valid UTF-8, no NUL bytes, at most 4096 bytes. |
| `x`, `y` | number | Finite. Absolute value at most `1,000,000`. Use integer values (see below). |
| `width`, `height` | number | Finite, `0..1,000,000`. Use integer values. |
| `filled` | boolean | Default `false`. `true` fills the rectangle; `false` draws a 1-pixel outline. |
| `color` | integer | `0..0xFFFFFFFF`, format `0xRRGGBBAA`. Default `0xFFFFFFFF` (opaque white). |
| `vectorScreenCoords` | boolean | Default `true` (active 512×256 screen). `false` selects the full 768×312 framebuffer. |

Important details:

- **There is no `DrawRectFilled` intrinsic.** Use `DrawRect(..., true, color, coords)`. Older Devector documentation also shows `DrawRect` with color as the sixth argument; in `v6emul` the sixth argument is `filled`, so that older call form raises a runtime error.
- Optional arguments cannot be skipped with `nil`. To pass `vectorScreenCoords` while keeping the default color, pass `0xFFFFFFFF` explicitly.
- Argument types are strict. Numeric strings, fractional IDs, non-boolean `filled`/`vectorScreenCoords`, NaN, infinities, negative dimensions, and out-of-range colors are runtime errors.
- Use integer-valued coordinates. The emulator accepts fractional values, but the VS Code overlay schema requires integers; one fractional coordinate makes the Display reject the whole overlay batch, so no items in that batch update.
- An item with alpha `0` (for example `0x00000000`) is retained but not drawn. It still occupies an overlay slot.
- Overlay text uses a monospace font and the `v6.scriptOverlays.fontSize` setting (`6..48` framebuffer pixels, default `12`). Text is drawn with a bottom-left baseline. There is no alignment, wrapping, or width control.
- Overlays are drawn on a separate transparent canvas above the emulated framebuffer. They are not written to emulated memory or the guest framebuffer.

#### Identity, retention, and draw order

Overlay identity is `(scriptId, itemId)`. Reusing the same `itemId` in a later execution updates the existing item in place; changing its type replaces it. There is no intrinsic to delete an individual overlay:

- An item that is no longer drawn remains visible with its last value.
- **Disable**, **Disable All**, **Delete**, and **Delete All** remove the affected script's overlays.
- **Compile** does not remove overlays. After changing overlay IDs or layout, disable and re-enable the script, or delete and re-add it, to clear stale items.
- Overlays are retained by the emulator and replayed to a reconnected Display.

Draw order is deterministic: lower `scriptId` first, then lower `itemId` first. Items with higher IDs are drawn on top. Script execution order is unrelated.

The Display polls overlay deltas every 250 ms while it is visible and connected, so dynamic overlays update at about 4 Hz, not at the 50 fps frame rate. **Hide All Overlays** (`v6.scriptOverlays.hidden`) hides the overlay canvas without stopping scripts or discarding retained items.

## Coordinates, color, and clipping

### Coordinate spaces

Overlay coordinates use a **left-bottom origin**. `y = 0` is the bottom edge and increases upward. This differs from the top-left origin used by many canvas APIs.

| `vectorScreenCoords` | Space | Origin | Extent |
|---|---|---|---|
| `true` (default) | Active screen | Left-bottom of the 512×256 active area | `x = 0..511`, `y = 0..255` |
| `false` | Full framebuffer | Left-bottom of the 768×312 frame | `x = 0..767`, `y = 0..311` |

The active screen occupies `x = 128..639`, `y = 16..271` in full-frame coordinates.

Negative values are offsets from the far edge of the selected space:

- `x < 0` becomes `width + x`. For a rectangle, `x = -width` aligns its right edge with the right edge of the space.
- `y < 0` becomes `height + y`. For a rectangle, `y = -height` aligns its top edge with the top edge of the space.
- For text, `x` is the left edge and `y` is the bottom baseline. Negative `x` moves the left edge toward the right side; it does not right-align the string. Use `y = -fontSize` to place a line of text against the top edge (the exact glyph extent depends on the font).

`DrawRect`'s `y` is the **bottom** edge; the rectangle extends upward by `height`. A rectangle at `x = 0, y = 0, width = 512, height = 256` exactly covers the active screen.

### Display crops

The Display can show the full frame or a cropped view. Overlays are clipped to the selected coordinate space **and** to the visible crop:

| Display mode | Visible crop | Effect on overlays |
|---|---|---|
| **Full** | 768×312 framebuffer | Active-screen items and full-frame items are both visible in their respective spaces. |
| **Border** | 544×288 centered window, including the 16-pixel border around the active screen | Full-frame items in the border area are visible. |
| **Borderless** | 512×256 active screen only | Full-frame items outside the active screen are clipped away. |

Items entirely outside the current crop are not drawn. Switching Display modes re-crops the retained items immediately; it does not change their stored coordinates.

### Color

Colors are `0xRRGGBBAA`. The low byte is alpha; `0xFF` is opaque and `0x00` is fully transparent. Alpha `0` items are not drawn at all.

| Value | Result |
|---|---|
| `0xFFFFFFFF` | Opaque white (default) |
| `0xFF0000FF` | Opaque red |
| `0x00FF00FF` | Opaque green |
| `0x0000FFFF` | Opaque blue |
| `0xFFFF00FF` | Opaque yellow |
| `0x00FFFFFF` | Opaque cyan |
| `0xFFFFFF80` | 50% white |
| `0xFF000040` | 25% red |
| `0x00000000` | Fully transparent; retained but not drawn |

The format is not `0xAARRGGBB`. A color written in the more common ARGB order will render with the wrong hue and alpha.

## Limits

These are the `v6emul` defaults from `scripts.h`. The extension validates inputs against the values the server advertises, so an older or custom emulator can impose smaller limits.

| Limit | Value |
|---|---|
| Script name | 1024 UTF-8 bytes |
| Script path | 4096 UTF-8 bytes |
| Script source | 1 MiB (1,048,576 bytes) |
| Script records | 256 |
| Error text returned to the client | 4096 UTF-8 bytes |
| Lua VM instructions per script execution | 100,000 |
| Wall-clock time per script execution | 25 ms |
| Overlays per script | 256 unique item IDs |
| Overlays across all scripts | 1024 items |
| Overlay text | 4096 UTF-8 bytes |
| Overlay coordinate magnitude | 1,000,000 |
| Overlay item ID range | `0..2147483647` |

## Examples

### 1. One-shot state dump (Run Once)

Use this while paused to inspect the current CPU state. The output goes to the **v6emul** Output channel.

```lua
print(string.format(
    "AF=%04X BC=%04X DE=%04X HL=%04X SP=%04X PC=%04X",
    GetPSW(), GetBC(), GetDE(), GetHL(), GetSP(), GetPC()))
```

`GetPC()` is the next instruction to execute. `GetOpcode()` is the instruction that last retired, so the two do not describe the same instruction. Add `GetOpcode()` only when you want the last retired opcode.

### 2. FPS HUD at a known PC

The original Devector example reads a 16-bit frame counter from `0x05CC`/`0x05CD` and redraws when the next instruction is at `0x05CB`:

```lua
local pc = GetPC()
if pc ~= 0x05CB then return end

local fps = GetByteGlobal(0x05CD) * 256 + GetByteGlobal(0x05CC)
DrawText(1, string.format("FPS %d", fps), 0, 0, 0xFFFFFFFF, false)
```

The guard is important: without it, the script runs on every instruction. If the program never reaches `0x05CB`, nothing is drawn. Find a suitable address with a breakpoint or the Trace Log, or use the cycle gate in example 4.

### 3. Critical-section BC clobber check

This is the Devector example corrected for the current intrinsics. It stops when a suspicious opcode runs while the stack is in a critical range and the interrupt vector still has its expected bytes.

```lua
local sp = GetSP()
if sp <= 0x7FBE or sp >= 0x7FFE then return end

local opcode = GetOpcode()
if opcode > 0x4F then return end
if opcode > 0x0E and opcode < 0x40 then return end

local skip = {
    [0x00] = true, [0x02] = true, [0x07] = true,
    [0x08] = true, [0x09] = true, [0x0A] = true,
}
if skip[opcode] then return end
if not GetINTE() then return end

if GetByteGlobal(0x38) ~= 0xC3
    or GetByteGlobal(0x39) ~= 0x78
    or GetByteGlobal(0x3A) ~= 0x05 then
    return
end

print(string.format("BC clobber risk: PC=%04X opcode=%02X", GetPC(), opcode))
Break()
```

The table is created on every run, but the cheap guards return first. If this script is too slow, move the table to a namespaced global created on first use.

### 4. Panel, label, and moving bar

This script updates about four times per second using the cycle counter, so it does not need a magic PC address:

```lua
local cc = GetCC()
if cc - (hudLastCC or 0) < 750000 then return end
hudLastCC = cc

hudFrame = (hudFrame or 0) + 1
local x = hudFrame % 400

DrawRect(1, 8, 8, 160, 28, true, 0x000000A0)   -- translucent panel
DrawRect(2, 8, 8, 160, 28, false, 0xFFFFFFFF)  -- outline
DrawText(3, string.format("frame %d", hudFrame), 16, 28, 0xFFFFFFFF)
DrawRect(4, 16 + x, 48, 48, 10, true, 0x00C0FFFF)
```

`DrawRect`'s `y` is the bottom edge, so the panel spans `y = 8..36` and the text baseline at `y = 28` sits inside it. The globals `hudLastCC` and `hudFrame` persist between runs; give them a script-specific prefix if other scripts use similar names. The overlays update in place at the Display's 250 ms poll rate.

### 5. Memory dump with Run Once

Use **Run Once** for bounded one-shot work. This dumps 64 bytes of main RAM to the Output channel:

```lua
local base = 0x2000
local bytes = {}
for offset = 0, 63 do
    bytes[#bytes + 1] = string.format("%02X", GetByteGlobal(base + offset))
end
print(string.format("%04X: %s", base, table.concat(bytes, " ")))
```

A full 64 KiB scan with `GetByteGlobal` does not fit the 100,000-instruction budget. Scan a small range, or use **Hex Viewer** and **Memory Edits** for bulk work.

### 6. Conditional break with a label fallback

`GetLabelAddr` is useful only when the emulator has a label table. Keep a numeric fallback:

```lua
local target = GetLabelAddr("main_loop")
if target < 0 then target = 0x0100 end

if GetPC() ~= target then return end
if GetA() ~= 0 then return end

print(string.format("A=0 at %04X", target))
Break()
```

This stops each time the next instruction is `main_loop` (or `0x0100`) with `A = 0`, including after resuming. To stop only on the first hit, guard the `Break()` with a namespaced global flag.

### 7. Watch a byte for changes

```lua
-- Expensive: reads memory on every instruction. Keep it disabled until needed.
local address = 0x2000
local value = GetByteGlobal(address)

if watchedValue ~= nil and value ~= watchedValue then
    print(string.format("byte %04X: %02X -> %02X (PC=%04X)",
        address, watchedValue, value, GetPC()))
    Break()
end
watchedValue = value
```

The first execution initializes `watchedValue`; later executions compare against the previous instruction's value. Because the script runs after the write retires, the printed `PC` is the instruction after the write. Disable this script when you are not actively watching the byte.

## Common pitfalls

- **A script runs after every retired instruction.** There is no per-frame mode. Always put a `GetPC()` or `GetCC()` guard before expensive work, and keep the hot path to a few comparisons.
- **`GetPC()` is the next instruction; `GetOpcode()` is the previous instruction.** A PC gate fires before the instruction at that address executes. Do not use `GetOpcode()` to inspect the instruction at `GetPC()`.
- **Saving the `.lua` file does not reload it.** The compiled chunk is retained. Use **Compile** after every edit. Changing Path recompiles automatically; editing Name or Activity does not.
- **A runtime error stops automatic execution.** The row stays in the error state and the script is skipped until a successful **Compile** or **Run Once**. Fix the error first.
- **Compile does not clear overlays.** Old items remain until the script is disabled/deleted or the IDs are overwritten. Disable and re-enable after changing the overlay layout.
- **There is no per-item overlay delete.** An item that stops being drawn keeps its last value. Use a stable ID and update it, set its alpha to `0` to hide it, or disable/delete the script to free its slots.
- **Alpha `0` still occupies a slot.** Transparent items count toward the 256-per-script and 1024-total limits.
- **Colors are `0xRRGGBBAA`, not `0xAARRGGBB`.** Check the alpha byte before wondering why an overlay is invisible or the wrong color.
- **Use integer coordinates.** Fractional values pass the emulator but make the VS Code Display reject the whole overlay batch.
- **`DrawRect` argument order is `(id, x, y, width, height, filled, color, coords)`.** There is no `DrawRectFilled`; the sixth argument is a boolean, not a color.
- **Optional arguments cannot be `nil`.** Pass the default value explicitly when you need to reach a later optional argument.
- **`GetByteGlobal` is limited to `0x00000..0x20FFFF`.** Out-of-range addresses are not Lua errors; they may terminate the emulator.
- **`GetLabelAddr` usually returns `-1`.** Current `v6emul` builds do not load a label table in the VS Code workflow. Use numeric addresses or a fallback.
- **`GetHLTA()` is the HLT latch, not a register.** `GetMachineCycles()` is a machine-cycle index, not the total cycle count; use `GetCC()` for timing.
- **`Break()` does not abort the script.** It requests a stop after the chunk finishes and the current instruction completes.
- **Overlays refresh at about 4 Hz.** They are polled every 250 ms while the Display is visible; do not use them for frame-accurate animation.
- **The Display crop hides items.** Full-frame overlays outside the active screen disappear in Borderless mode. Check the current Display mode.
- **`os` and `io` are unavailable.** There is no file access, wall clock, or module loading. Use `GetCC()` for time and keep data in globals.
- **`print` is not free.** It writes to the v6emul Output channel and can flood it if called per instruction.
- **Automatic scripts require the emulator debugger to be attached.** v6vscode attaches it for Run Project, debug, and attach sessions. An external client that does not attach the debugger only gets **Run Once**.

## Performance checklist

Scripts are part of the per-instruction hot path. In rough order of impact:

1. Return as early as possible. Put the cheapest test first: `GetPC()` or `GetCC()` before memory reads and drawing.
2. Read each getter once into a local. `local sp = GetSP()` is cheaper than three `GetSP()` calls.
3. Avoid `string.format`, table construction, and `print` in the hot path. Build text only after the gate passes.
4. Reuse tables and other objects through namespaced globals instead of rebuilding them on every instruction.
5. Do not loop over memory in an always-on script. Use **Run Once** for bounded scans, or **Hex Viewer** for large ranges.
6. Disable scripts you are not using. An enabled script runs on every retired instruction even if its body immediately returns.
7. Prefer **Watchpoints** for "stop when this byte changes" and **Memory Edits** for writes. Scripts are best at cross-register conditions and custom HUDs.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `does not support script schema 1` | The `v6emul` build is older than script schema 1. | Update `v6emul`. |
| `No active emulator session` | No emulator is connected. | Start a run or debug session. |
| Enabled script never runs | The debugger is not attached (external session), Activity is off, compilation failed, or a previous runtime error is latched. | Use a v6vscode session (it attaches the debugger), enable Activity, hover the Compilation cell, then Compile or Run Once successfully. |
| Script runs once and then stops | A runtime error disabled automatic execution. | Read the row tooltip, fix the script, then **Compile** or **Run Once**. |
| Edited `.lua` has no effect | The compiled chunk is retained. | Press **Compile**. |
| Overlay does not appear | Display closed/hidden, alpha `0`, outside the current crop, overlay schema unsupported, fractional coordinates, or an overlay-limit error. | Open/visible Display, check color and coordinates, use a supported emulator, keep coordinates integral, read the runtime error. |
| Overlay keeps its old value | Overlays are retained and are only replaced by the same `(scriptId, itemId)`. | Reuse the same ID, or disable/enable the script to clear stale items. |
| `Overlay limit per script exceeded` | More than 256 unique item IDs in one script. | Reuse IDs for items that move/change, or split the work across scripts. |
| `Overlay total limit exceeded` | More than 1024 items across all scripts. | Disable or delete scripts that are not needed. |
| `Script execution budget exceeded` | A loop, scan, or heavy per-instruction body exceeded 100,000 VM instructions or 25 ms. | Add a PC/cycle gate, reduce the work, or move it to **Run Once**. |
| `Run Once` is unavailable while running | The server does not advertise `scriptRunOnceWhileRunning`. | Pause the emulator first. |
| Add/Compile/Delete is unavailable while running | The server does not advertise `scriptMutationsWhileRunning`. | Pause the emulator first. |
| `GetLabelAddr` returns `-1` | The emulator has no label table entry with that exact name. | Use a numeric address or a fallback. |
| `GetByteGlobal` terminates the emulator | The address was outside `0x00000..0x20FFFF`. | Clamp or validate the address. |
| `print` output is missing | It goes to the **v6emul** Output channel, not the Debug Console. | Open **Output > v6emul**. |
| Text is too small/large | The overlay font-size setting is global. | Change `v6.scriptOverlays.fontSize` (`6..48`). |
| Overlay is the wrong color or invisible | The color is in `0xAARRGGBB` order. | Use `0xRRGGBBAA`; the last byte is alpha. |
| `DrawRect` reports a type error | The sixth argument is `filled`, not `color`, or a numeric string/`nil` was passed. | Use `(id, x, y, width, height, filled, color, coords)` with strict types. |
| Text is clipped or does not wrap | Overlay text has no wrapping or width control. | Keep lines short and position them manually. |

## Related documentation

- [Emulator](emulator.md) — session lifecycle, IPC, Display panel, and Scripts service boundaries
- [Debugging](debugging.md) — debug launch behavior, breakpoints, and supported debug surfaces
- [Settings and Error UX](settings.md) — `v6.scriptOverlays.hidden` and `v6.scriptOverlays.fontSize`
- [Manual overlay fixtures](../test/manual/script-overlays/README.md) — visual checks for coordinates, alpha, clipping, and replacement
