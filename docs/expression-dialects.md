# Read-only expression contracts

One bounded syntax/AST/precedence/arithmetic implementation serves two policies.
Both cap input at 4096 characters, tokens at 512 and parenthesis nesting at 64.
Integer arithmetic rejects unsafe JavaScript integer results; it never executes
target code. Address/global/byte range checks belong to the consuming feature.

| Policy | Literals and identifiers | Operations and lookup |
|---|---|---|
| Address | Decimal, `0xNN`, `$NN`, `NNh`; assembler names including `.`, `@`, `$` | Unary `+/-`, `+`, `-`, `*`, parentheses. Symbols mean **addresses/constants**, never memory contents. |
| C value | Decimal/`0xNN` plus existing integer suffixes and character literals; C identifiers | Arithmetic, bitwise, comparisons, logical short-circuit; typed dereference/address-of/index/member/cast. DWARF variables resolve before registers and ELF fallback. |

`hero.health` is one assembler symbol in the address policy and typed member
access in the C policy. C cast/pointer/scalar interpretation remains in the value
domain, not the parser. Address parsing cannot opt into dereference or comparison
by sharing the AST. C mixed signed/unsigned promotions and floating point remain
unsupported as previously documented; consolidation does not claim a complete C
interpreter. Function calls, assignments and target mutation are not supported.