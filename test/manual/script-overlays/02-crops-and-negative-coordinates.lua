-- Run Once, then switch between Full, Border, and Borderless modes.
-- White items use active-screen coordinates. Orange items use full-frame coordinates.

DrawText(10, "BOTTOM LEFT", 0, 0, 0xFFFFFFFF)
DrawText(11, "TOP RIGHT", -80, -1, 0xFFFFFFFF)
DrawRect(20, -72, -36, 68, 32, false, 0xFFFFFFFF)

DrawText(30, "FULL FRAME BL", 8, 8, 0xFF8040FF, false)
DrawText(31, "FRAME TR", -72, -1, 0xFF8040FF, false)
DrawRect(32, 112, 24, 544, 288, false, 0xFF8040FF, false)
DrawRect(33, 96, 32, 64, 32, true, 0xFF804080, false)
