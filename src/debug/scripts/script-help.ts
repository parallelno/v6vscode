export interface ScriptHelpItem {
    readonly id: string;
    readonly label: string;
    readonly group: string;
    readonly help: string;
    readonly code: string;
}

function intrinsic(group: string, signature: string, help: string, code = signature): ScriptHelpItem {
    return { id: signature.split('(')[0], group, label: signature, help, code };
}

export const scriptIntrinsics: readonly ScriptHelpItem[] = [
    intrinsic('CPU timing and state', 'GetCC()', 'Returns the cumulative CPU clock-cycle count. Use differences for timing; reset or rewind may move it backwards.'),
    intrinsic('CPU timing and state', 'GetPC()', 'Returns the 16-bit program counter. In the automatic hook it points to the next instruction, not the opcode reported by GetOpcode().'),
    intrinsic('CPU timing and state', 'GetSP()', 'Returns the 16-bit stack pointer.'),
    intrinsic('CPU timing and state', 'GetMachineCycles()', 'Returns the current machine-cycle index, usually zero at an instruction boundary. It is not an elapsed count.'),
    intrinsic('CPU timing and state', 'GetOpcode()', 'Returns the recorded instruction opcode (normally the one just executed). Run Once does not fetch a new opcode.'),
    intrinsic('Registers', 'GetPSW()', 'Returns the AF word: A in the high byte and flags in the low byte.'),
    ...['BC', 'DE', 'HL'].map(pair => intrinsic('Registers', `Get${pair}()`, `Returns the unsigned 16-bit ${pair} register pair.`)),
    ...['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L'].map(reg => intrinsic('Registers', `Get${reg}()`, `Returns the unsigned ${reg === 'F' ? 'flags byte' : `8-bit ${reg} register`}.`)),
    ...[['S', 'sign'], ['Z', 'zero'], ['AC', 'auxiliary carry'], ['P', 'parity'], ['C', 'carry']].map(([flag, meaning]) =>
        intrinsic('Flags and interrupts', `GetFlag${flag}()`, `Returns the ${meaning} flag as a Lua boolean.`)),
    intrinsic('Flags and interrupts', 'GetINTE()', 'Returns whether interrupts are enabled (boolean).'),
    intrinsic('Flags and interrupts', 'GetIFF()', 'Returns the interrupt flip-flop (boolean).'),
    intrinsic('Flags and interrupts', 'GetHLTA()', 'Returns whether the CPU halt latch is set (boolean).'),
    intrinsic('Memory and labels', 'GetByteGlobal(address)', 'Reads physical RAM, not the CPU-mapped address space or boot ROM. Pass an integer in 0x00000..0x20FFFF.', 'GetByteGlobal(0x2000)'),
    intrinsic('Memory and labels', 'GetLabelAddr(name)', 'Looks up an exact, case-sensitive label in the emulator. Returns -1 when absent; VS Code ELF symbols are not automatically in this table.', 'GetLabelAddr("main_loop")'),
    intrinsic('Execution control', 'Break()', 'Requests an emulator stop. The Lua chunk keeps running until it returns or fails.'),
    intrinsic('Display overlays', 'DrawText(id, text, x, y [, color [, vectorScreenCoords]])', 'Draws retained UTF-8 text. Reuse the ID to update it. Integer coordinates start at the bottom left; negative coordinates count from the right/top. Color defaults to opaque white (0xRRGGBBAA); the final flag defaults to active-screen coordinates.', 'DrawText(1, "Hello", 8, 8)'),
    intrinsic('Display overlays', 'DrawRect(id, x, y, width, height [, filled [, color [, vectorScreenCoords]]])', 'Draws a retained rectangle growing right and up. Use integer coordinates and non-negative dimensions. The sixth argument is a boolean (false for outline, true for fill). There is no DrawRectFilled.', 'DrawRect(1, 8, 8, 64, 24, true, 0x00FF0080)'),
];

export interface ScriptExample extends ScriptHelpItem {
    readonly filename: string;
}

function example(id: string, label: string, help: string, code: string): ScriptExample {
    return { id, label, group: 'Examples', help, code: `${code}\n`, filename: `v6-${id}.lua` };
}

export const scriptExamples: readonly ScriptExample[] = [
    example('state-dump', 'One-shot state dump', 'Use Run Once while paused. Look for the registers in the v6emul Output channel.', `print(string.format(
    "AF=%04X BC=%04X DE=%04X HL=%04X SP=%04X PC=%04X",
    GetPSW(), GetBC(), GetDE(), GetHL(), GetSP(), GetPC()))`),
    example('fps-hud', 'FPS HUD at a known PC', 'Enable this for a program that reaches 0x05CB and stores a little-endian FPS value at 0x05CC. Adapt both addresses to your ROM.', `if GetPC() ~= 0x05CB then return end
local fps = GetByteGlobal(0x05CD) * 256 + GetByteGlobal(0x05CC)
DrawText(1, string.format("FPS %d", fps), 8, 8)`),
    example('bc-check', 'Critical-section BC check', 'Breaks if BC changes between samples when interrupts are enabled and SP is in the specified range. Adapt the range to your program.', `local bc = GetBC()
local previous = v6_bc_check_previous
v6_bc_check_previous = bc
local sp = GetSP()
if previous == nil or bc == previous then return end
if sp <= 0x7FBE or sp >= 0x7FFE or not GetINTE() then return end
print(string.format("BC changed: %04X -> %04X; next PC=%04X", previous, bc, GetPC()))
Break()`),
    example('moving-bar', 'Panel, label, and moving bar', 'Enable to animate an overlay using emulated CPU cycles. Run Once draws a snapshot.', `local cc = GetCC()
local previous = v6_moving_bar_cc
if previous and cc >= previous and cc - previous < 750000 then return end
v6_moving_bar_cc = cc
local phase = math.floor(cc / 750000) % 200
DrawRect(1, 8, 8, 160, 28, true, 0x000000A0)
DrawRect(2, 8, 8, 160, 28)
DrawText(3, string.format("PC %04X", GetPC()), 16, 16)
DrawRect(4, 16 + phase, 48, 48, 10, true, 0x00C0FFFF)`),
    example('memory-dump', 'One-shot memory dump', 'Use Run Once to print 64 bytes of physical main RAM at 0x2000 in the v6emul Output channel.', `local base = 0x2000
local bytes = {}
for offset = 0, 63 do
    bytes[#bytes + 1] = string.format("%02X", GetByteGlobal(base + offset))
end
print(string.format("%04X: %s", base, table.concat(bytes, " ")))`),
    example('conditional-break', 'Conditional break with a label fallback', 'Breaks when the next PC is main_loop and A is zero. Change the fallback address to match your ROM.', `if GetA() ~= 0 then return end
local target = GetLabelAddr("main_loop")
if target < 0 then target = 0x0100 end
if GetPC() == target then Break() end`),
    example('watch-byte', 'Watch a byte for changes', 'Enable to break on changes to a physical RAM byte. Change the address to the byte you want to watch.', `local address = 0x2000
local value = GetByteGlobal(address)
local previous = v6_watch_byte_previous
v6_watch_byte_previous = value
if previous ~= nil and previous ~= value then
    print(string.format("%04X: %02X -> %02X (next PC=%04X)", address, previous, value, GetPC()))
    Break()
end`),
];
