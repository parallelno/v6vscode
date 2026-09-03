/**
 * Stopped-generation debug context: builds the per-frame evaluation context
 * (registers, CFA, frame base, memory) from a live stopped emulator state and
 * unwinds physical frames through DWARF CFI.
 *
 * One context is valid for exactly one stopped generation; callers must not
 * reuse it after resume, reset, or a newer stop.
 */

import { DebugMetadataIndex } from './debug-metadata-index';
import { DwarfEvalContext } from './dwarf-expression';
import { toDwarfRegisters, DWARF_REG } from './v6c-register-map';
import { StopMemoryReader } from './stop-memory-reader';
import { UnwindRow } from './dwarf-cfi';

export interface PhysicalFrame {
    index: number;
    pc: number;
    sp: number;
    /** DWARF-numbered registers for this frame. */
    registers: Record<number, number>;
    /** Canonical Frame Address, when CFI was available. */
    cfa?: number;
    /** Verified caller resume PC (return address), when recoverable. */
    returnPc?: number;
}

const MAX_FRAMES = 64;

export class DebugStopContext {
    private constructor(
        readonly metadata: DebugMetadataIndex,
        readonly memory: StopMemoryReader,
        readonly topRegisters: Record<number, number>,
    ) {}

    static from(
        metadata: DebugMetadataIndex,
        client: import('../../emulator/client/ipc-client').IpcClient,
        regs: import('../../emulator/protocol/ipc-commands').GetRegsResponse,
    ): DebugStopContext {
        return new DebugStopContext(metadata, new StopMemoryReader(client), toDwarfRegisters(regs));
    }

    get pc(): number { return this.topRegisters[DWARF_REG.PC] ?? 0; }
    get sp(): number { return this.topRegisters[DWARF_REG.SP] ?? 0; }

    /**
     * Unwind physical frames from the top of stack. Stops at the first
     * unsupported or unverifiable CFI rule; never guesses from stack words.
     */
    async unwind(): Promise<PhysicalFrame[]> {
        const frames: PhysicalFrame[] = [];
        let registers: Record<number, number> = { ...this.topRegisters };
        let pc = this.pc;
        let sp = this.sp;
        const seen = new Set<string>();
        const seenPcs = new Set<number>();

        for (let index = 0; index < MAX_FRAMES; index++) {
            const key = `${pc}:${sp}`;
            if (seen.has(key) || seenPcs.has(pc)) { break; }
            seen.add(key);
            seenPcs.add(pc);

            const row = this.metadata.cfiRowAt(pc);
            const frame: PhysicalFrame = { index, pc, sp, registers: { ...registers} };
            frames.push(frame);

            if (!row) { break; } // no CFI: honest single frame
            const next = await this.unwindOne(row, registers, sp);
            if (!next) { break; }

            frame.cfa = next.cfa;
            frame.returnPc = next.returnPc;
            registers = next.registers;
            pc = next.returnPc;
            sp = next.callerSp;
            if (pc === undefined || sp === undefined) { break; }
        }
        return frames;
    }

    /**
     * Build the DWARF expression evaluation context for a frame.
     *
     * The evaluator is synchronous, so reads are served from a cache that the
     * caller must populate via prefetch() before evaluation. An address missing
     * from the cache yields undefined (unavailable), not an IPC call.
     */
    evalContext(frame: PhysicalFrame, cache: Map<number, number>): DwarfEvalContext {
        const cfa = frame.cfa ?? frame.sp;
        const metadata = this.metadata;
        return {
            registers: frame.registers,
            cfa,
            frameBase: cfa,
            addressSize: 2,
            readMemory: (address, byteSize) => {
                const lo = cache.get(address & 0xFFFF);
                if (byteSize === 1) { return lo; }
                const hi = cache.get((address + 1) & 0xFFFF);
                if (lo === undefined || hi === undefined) { return undefined; }
                return lo | (hi << 8);
            },
            resolveAddress: index => metadata.resolveAddress(index),
        };
    }

    /** Populate the byte cache for a 16-bit range so evaluation can read it. */
    async prefetch(cache: Map<number, number>, address: number, length: number): Promise<void> {
        const bytes = await this.memory.readBytes(address, length);
        if (!bytes) { return; }
        for (let index = 0; index < bytes.length; index++) {
            cache.set((address + index) & 0xFFFF, bytes[index]);
        }
    }

    /**
     * Evaluate a frame's CFA and recover the caller's PC/SP/registers from one
     * unwind row. Returns undefined when any rule is unsupported.
     */
    private async unwindOne(
        row: UnwindRow,
        registers: Record<number, number>,
        currentSp: number,
    ): Promise<{ cfa: number; returnPc: number; callerSp: number; registers: Record<number, number> } | undefined> {
        const cfaRegister = registers[row.cfa.register];
        if (cfaRegister === undefined) { return undefined; }
        const cfa = cfaRegister + row.cfa.offset;
        if (cfa < 0 || cfa > 0xFFFF || cfa <= currentSp) { return undefined; }

        const returnPc = await this.recoverRegister(row, DWARF_REG.PC, cfa, registers);
        if (returnPc === undefined) { return undefined; } // undefined PC = honest boundary

        const callerRegisters: Record<number, number> = { ...registers };
        for (const [reg, rule] of row.registers) {
            if (rule.kind === 'undefined') { continue; }
            if (reg === DWARF_REG.PC) { continue; }
            const value = await this.recoverRegister(row, reg, cfa, registers);
            if (value !== undefined) { callerRegisters[reg] = value; }
        }
        callerRegisters[DWARF_REG.SP] = cfa;

        return { cfa, returnPc, callerSp: cfa, registers: callerRegisters };
    }

    private async recoverRegister(
        row: UnwindRow,
        register: number,
        cfa: number,
        registers: Record<number, number>,
    ): Promise<number | undefined> {
        const rule = row.registers.get(register);
        if (!rule) { return undefined; }
        switch (rule.kind) {
            case 'undefined':
                return undefined;
            case 'same_value':
                return registers[register];
            case 'register':
                return registers[rule.register];
            case 'offset': {
                const address = cfa + rule.offset;
                if (address < 0 || address + 1 > 0xFFFF) { return undefined; }
                return this.memory.read(address, 2);
            }
        }
    }
}
