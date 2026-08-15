-- Run Once while paused. Items with higher IDs draw after lower IDs.
-- The last rectangle is intentionally partially outside the active screen.

DrawRect(10, 64, 96, 160, 96, true, 0xFF000080)
DrawRect(11, 96, 80, 160, 96, true, 0x00FF0080)
DrawRect(12, 128, 64, 160, 96, true, 0x0000FF80)
DrawText(20, "ORDER: RED, GREEN, BLUE", 72, -72, 0xFFFFFFFF)
DrawRect(30, 480, 0, 80, 48, true, 0xFFFF0080)
DrawRect(31, 480, 0, 80, 48, false, 0xFFFFFFFF)
