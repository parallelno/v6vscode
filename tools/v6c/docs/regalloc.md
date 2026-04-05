# Register Allocator

**Module:** [regalloc.rs](../src/regalloc.rs) | **Lines:** 702

v6c uses a **demand-driven** register allocator designed for the Intel 8080's extremely scarce register set: 7 general registers organized as 4 logical units.

## Physical Registers (`PhysReg`)

| Register | Width | Role |
|----------|-------|------|
| `A` | 8-bit | Primary 8-bit accumulator; arithmetic, comparisons, I/O |
| `HL` | 16-bit pair | Primary 16-bit accumulator; only pair usable for indirect `(M)` access |
| `DE` | 16-bit pair | Secondary pair; used as second operand in `DAD D` |
| `BC` | 16-bit pair | Tertiary pair; loop counters, scratch |

**Preference order for 16-bit allocation:** HL → DE → BC (`PAIR_PREF`)

## Design Philosophy

Traditional graph-coloring register allocation is overkill for 4 registers. Instead, v6c uses a **demand-driven** approach:

1. The code generator requests a value in a **specific** register (e.g., "I need vreg `t5` in HL")
2. The allocator determines what's currently in that register
3. If occupied by a different live value, it **spills** the current occupant to memory
4. The requested value is **loaded** (or moved from another register)

## Location Tracking

Each virtual register is tracked with a `Location`:

| Location | Description |
|----------|-------------|
| `Reg(PhysReg)` | Currently in a physical register |
| `Memory(label)` | Spilled to a named memory address |
| `RematImm(value)` | Can be rematerialized as an immediate constant |
| `RematLabel(label)` | Can be rematerialized as a label address |

## Rematerialization

Instead of spilling/reloading cheap-to-compute values, the allocator can **rematerialize** them:

- **Immediate constants** — `LoadImm` values: rather than storing 42 to memory and reloading, emit `LXI H, 42`
- **Label addresses** — `AddrOfGlobal` values: emit `LXI H, label` instead of loading from a spill slot

Rematerialization is preferred when it's cheaper than a memory round-trip (saves 16+ cycles on 8080).

## Key Operations

### Allocate

```rust
fn allocate(vreg: VReg) → (PhysReg, Vec<MoveOp>)
```

Auto-pick a free register (respecting width and preference order). If none is free, evict the least-priority occupant.

### Ensure in Register

```rust
fn ensure_in_reg(vreg: VReg, target: PhysReg) → Vec<MoveOp>
```

Demand a specific register. This is the most common operation — the code generator frequently needs values in specific places:
- Operands for `DAD` must be in HL + DE
- Byte operations need values in A
- Indirect access requires pointers in HL

### Spill

```rust
fn spill(reg: PhysReg) → Option<MoveOp>
```

Save the current register contents to memory. Uses the vreg's assigned memory label (from call graph analysis) as the spill target.

### Move Operations (`MoveOp`)

The allocator produces `MoveOp` instructions that the code generator translates to 8080 assembly:

| MoveOp | Description | Typical 8080 Code |
|--------|-------------|-------------------|
| `Spill(vreg, PhysReg, label)` | Save register to memory | `SHLD label` / `STA label` |
| `Reload(vreg, PhysReg, label)` | Load from memory to register | `LHLD label` / `LDA label` |
| `LoadImm(vreg, PhysReg, value)` | Load immediate | `LXI H, value` / `MVI A, value` |
| `LoadLabel(vreg, PhysReg, label)` | Load label address | `LXI H, label` |
| `RegToReg(vreg, from, to)` | Register-to-register move | `MOV` / `XCHG` / `PUSH+POP` |

### Other Operations

| Method | Description |
|--------|-------------|
| `mark_allocated(vreg, reg)` | Manually assign vreg to a register |
| `mark_immediate(vreg, reg, value)` | Record that vreg holds a known immediate (enables rematerialization) |
| `mark_remat_imm_only(vreg, value)` | Mark vreg as rematerializable without allocating a register |
| `mark_remat_label_only(vreg, label)` | Mark vreg as label-rematerializable |
| `free(vreg)` | Release a vreg from its register |
| `save_all()` | Spill all occupied registers (before calls, asm blocks) |
| `reset()` | Clear all tracking state |
| `clobber(reg)` | Mark a register as clobbered (contents no longer valid) |

## Query Methods

| Method | Returns |
|--------|---------|
| `get_location(vreg)` | Current `Location` of a vreg |
| `occupant(reg)` | Which vreg (if any) is in a physical register |
| `is_free(reg)` | Whether a register is unoccupied |
| `immediate_of(vreg)` | Known constant value, if any |
| `label_of(vreg)` | Known label address, if any |

## Interaction with Code Generator

The code generator calls `ensure_hl()`, `ensure_de()`, `ensure_a()` which internally:
1. Call `RegAllocator::ensure_in_reg(vreg, target)`
2. Receive a `Vec<MoveOp>`
3. Translate each `MoveOp` to 8080 assembly instructions
4. Emit those instructions before the actual operation
