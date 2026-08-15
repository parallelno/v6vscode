-- Run Once while paused, then test Full, Border, and Borderless display modes.
-- DrawText(id, text, x, y, color?, vectorScreenCoords?)
-- DrawRect(id, x, y, width, height, filled?, color?, vectorScreenCoords?)

DrawText(10, "ACTIVE SCREEN", 8, -8, 0xFFFFFFFF)
DrawText(11, "RGBA + text", 8, -28, 0x40C0FFFF)
DrawRect(20, 4, 198, 180, 54, false, 0x40C0FFFF)
DrawRect(21, 12, 202, 36, 12, true, 0x20FF40A0)
DrawRect(22, 56, 202, 36, 12, true, 0xFF8040A0)
DrawRect(23, 100, 202, 36, 12, true, 0x4080FFA0)
