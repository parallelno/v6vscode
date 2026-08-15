-- Keep this script Active while the emulator runs.
-- Each invocation replaces the same retained overlay IDs.

frameCounter = (frameCounter or 0) + 1
local phase = frameCounter % 180
local x = 16 + phase * 2

DrawText(10, "FRAME " .. frameCounter, 8, -8, 0xFFFFFFFF)
DrawText(11, "REPLACED IN PLACE", 8, -28, 0x80FF40FF)
DrawRect(20, x, 180, 48, 20, true, 0x40C0FFFF)
DrawRect(21, x, 180, 48, 20, false, 0xFFFFFFFF)
