import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import { parseElf32 } from '../../../src/debug/metadata/elf32-reader';
import { DebugMetadataIndex } from '../../../src/debug/metadata/debug-metadata-index';
import { DebugStopContext } from '../../../src/debug/metadata/debug-stop-context';
import { toDwarfRegisters, DWARF_REG } from '../../../src/debug/metadata/v6c-register-map';
import { StopMemoryReader } from '../../../src/debug/metadata/stop-memory-reader';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';

const FIXTURE_O0 = path.join(__dirname, '..', '..', '..', 'temp', 'cdbg', 'probe-O0.elf');
const FIXTURE_EXISTS = fs.existsSync(FIXTURE_O0);

describe('v6c-register-map', () => {
    it('maps GET_REGS pairs to frozen DWARF numbers', () => {
        const regs = toDwarfRegisters({
            cc: 0, ints: 0, m: 0,
            pc: 0x0194, sp: 0x7FFE,
            af: 0x1200, bc: 0x3400, de: 0x5600, hl: 0x7800,
        });
        expect(regs[DWARF_REG.A]).to.equal(0x12);
        expect(regs[DWARF_REG.B]).to.equal(0x34);
        expect(regs[DWARF_REG.H]).to.equal(0x78);
        expect(regs[DWARF_REG.BC]).to.equal(0x3400);
        expect(regs[DWARF_REG.HL]).to.equal(0x7800);
        expect(regs[DWARF_REG.SP]).to.equal(0x7FFE);
        expect(regs[DWARF_REG.PC]).to.equal(0x0194);
        expect(regs[DWARF_REG.PC]).to.not.equal(regs[DWARF_REG.SP]);
    });
});

describe('StopMemoryReader', () => {
    function makeClient(bytes: number[]) {
        return {
            send: async (command: IpcCommand, request: any) => {
                expect(command).to.equal(IpcCommand.GET_MEM);
                const addr = request.addr;
                return { ok: true, data: { addr, data: bytes.slice(addr, addr + request.len) } };
            },
        } as any;
    }

    it('reads a little-endian word from global RAM', async () => {
        const bytes = new Array<number>(0x10000).fill(0);
        bytes[0x0151] = 0x34;
        bytes[0x0152] = 0x12;
        const reader = new StopMemoryReader(makeClient(bytes));
        expect(await reader.read(0x0151, 2)).to.equal(0x1234);
        expect(await reader.read(0x0151, 1)).to.equal(0x34);
    });

    it('rejects reads that wrap past 0xFFFF', async () => {
        const reader = new StopMemoryReader(makeClient(new Array(0x10000).fill(0)));
        expect(await reader.read(0xFFFF, 2)).to.equal(undefined);
    });

    it('returns undefined when the backend read fails', async () => {
        const reader = new StopMemoryReader({ send: async () => ({ ok: false }) } as any);
        expect(await reader.read(0x0100, 2)).to.equal(undefined);
    });
});

(FIXTURE_EXISTS ? describe : describe.skip)('DebugStopContext against real V6C ELF', () => {
    let metadata: DebugMetadataIndex;

    before(() => {
        metadata = new DebugMetadataIndex(parseElf32(fs.readFileSync(FIXTURE_O0)));
    });

    it('unwinds a single honest frame when the top has no caller CFI boundary violation', async () => {
        const main = metadata.scopes.subprograms.find(s => s.name === 'main')!;
        const pc = main.ranges[0].start;
        // A stack where CFA=SP+2 and PC=[CFA-2] recovers a caller at a made-up return address.
        const sp = 0x7000;
        const returnAddress = 0x0151;
        const bytes = new Array<number>(0x10000).fill(0);
        bytes[sp] = returnAddress & 0xFF;
        bytes[sp + 1] = (returnAddress >> 8) & 0xFF;
        const client = {
            send: async (_c: IpcCommand, request: any) => ({
                ok: true,
                data: { addr: request.addr, data: bytes.slice(request.addr, request.addr + request.len) },
            }),
        } as any;

        const context = DebugStopContext.from(metadata, client, {
            cc: 0, ints: 0, m: 0, pc, sp,
            af: 0, bc: 0, de: 0, hl: 0,
        });
        const frames = await context.unwind();

        expect(frames.length).to.be.greaterThan(0);
        expect(frames[0].pc).to.equal(pc);
        // The caller frame is recovered from the CFI rule PC=[CFA-2] = [SP].
        expect(frames[0].cfa).to.equal(sp + 2);
        expect(frames[0].returnPc).to.equal(returnAddress);
        expect(frames.length).to.be.greaterThan(1);
        expect(frames[1].pc).to.equal(returnAddress);
    });

    it('builds an evaluation context that resolves a register location', async () => {
        const main = metadata.scopes.subprograms.find(s => s.name === 'main')!;
        const pc = main.ranges[0].start;
        const client = { send: async () => ({ ok: true, data: { addr: 0, data: [0] } }) } as any;
        const context = DebugStopContext.from(metadata, client, {
            cc: 0, ints: 0, m: 0, pc, sp: 0x7000, af: 0, bc: 0x1234, de: 0, hl: 0,
        });
        const frames = await context.unwind();
        const cache = new Map<number, number>();
        const evalContext = context.evalContext(frames[0], cache);

        expect(evalContext.registers[DWARF_REG.BC]).to.equal(0x1234);
        expect(evalContext.cfa).to.equal(frames[0].cfa ?? frames[0].sp);
        expect(evalContext.addressSize).to.equal(2);
    });
});
