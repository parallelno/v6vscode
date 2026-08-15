# Script Overlay Manual Fixtures

Use these files with a v6emul build advertising script-overlay schema 1.

1. Open **Scripts** and add the fixture using its absolute path.
2. Compile it, then use **Run Once** for the paused tests or enable it for the dynamic test.
3. Open **Display** and switch among **Full**, **Border**, and **Borderless** in Settings.

| Fixture | Action | Expected result |
|---|---|---|
| `01-baseline.lua` | Run Once | White/cyan text and outline plus three translucent colored rectangles appear in the active screen. |
| `02-crops-and-negative-coordinates.lua` | Run Once | White active-screen bottom-left/top-right markers remain in every mode; orange full-frame items appear only where that crop includes them. |
| `03-dynamic-replacement.lua` | Enable while running | Counter and moving rectangle update in place without accumulating duplicate items. Disable the script to confirm its overlays disappear. |
| `04-order-alpha-and-clipping.lua` | Run Once | Overlapping red, green, and blue translucent rectangles preserve draw order; yellow rectangle clips at the lower-right active-screen edge. |

Additional checks:

- Toggle **Hide All Overlays**: the overlay canvas clears immediately and restores the latest values when re-enabled.
- Change Font Size to `6`, `12`, and `48`: text redraws immediately without changing retained script state.
- Close and reopen Display: active overlays remain visible after reopening.
- Disable or delete a script: only that script's overlays disappear.
- Restart or reload the emulator session: retained overlays replay after reconnect when the server retains the debugger.

All coordinates are framebuffer pixels with a left-bottom origin. Non-negative `x` and `y` are measured from the left and bottom; negative `x` and `y` are measured from the right and top. `DrawText` and `DrawRect` use active-screen coordinates by default; pass `false` as the final argument to use the full `768x312` framebuffer. Colors are `0xRRGGBBAA`.
