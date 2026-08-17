import { expect } from 'chai';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { parseElf32 } from '../../../src/debug/metadata/elf32-reader';
import { DebugMetadataIndex } from '../../../src/debug/metadata/debug-metadata-index';
import { DebugStopContext } from '../../../src/debug/metadata/debug-stop-context';
import { DWARF_REG } from '../../../src/debug/metadata/v6c-register-map';
import { IpcClient } from '../../../src/emulator/client/ipc-client';
import { IpcCommand } from '../../../src/emulator/protocol/ipc-commands';
import { Logger } from '../../../src/platform/logging/logger';

const PROBE_ELF = path.join(__dirname, '..', '..', '..', 'temp', 'cdbg', 'probe-O0.elf');
const PROBE_ROM = path.join(__dirname, '..', '..', '..', 'temp', 'cdbg', 'probe-O0.rom');
const EMULATOR = process.env.V6EMUL;
const CAN_RUN = !!EMULATOR && fs.existsSync(EMULATOR) && fs.existsSync(PROBE_ELF) && fs.existsSync(PROBE_ROM);
const PORT = 39777; // arbitrary high port, avoids common clashes

(CAN_RUN ? describe : describe.skip)('DebugStopContext real-emulator verification', function () {
    this.timeout(20_000);

    let emulator: ChildProcess;
    let client: IpcClient;
    let metadata: DebugMetadataIndex;

    before(async () => {
        metadata = new DebugMetadataIndex(parseElf32(fs.readFileSync(PROBE_ELF)));
        emulator = spawn(EMULATOR!, [
            '--serve', '--tcp-port', String(PORT),
            '--boot-rom', path.join(__dirname, '..', '..', '..', 'res', 'boot', 'boots.bin'),
            '--speed', 'max',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        emulator.stderr?.on('data', () => {});

        client = new IpcClient(new Logger());
        const deadline = Date.now() + 8000;
        for (;;) {
            try { await client.connect(PORT); break; } catch (error) {
                if (Date.now() > deadline) { throw error; }
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        await client.send(IpcCommand.DEBUG_ATTACH, { data: true });
        await client.send(IpcCommand.STOP);
        await client.send(IpcCommand.LOAD_ROM, {
            data: Array.from(fs.readFileSync(PROBE_ROM)),
            addr: 0x100,
            autorun: false,
        });
    });

    after(async () => {
        await client?.send(IpcCommand.EXIT, {}).catch(() => {});
        client?.disconnect();
        emulator?.kill();
    });

    it('evaluates a local variable and unwinds a real call chain from live state', async () => {
        const accumulate = metadata.scopes.subprograms.find(s => s.name === 'accumulate')!;
        const breakpointAddress = accumulate.ranges[0].start;

        // Stop inside accumulate so we have a real caller (main) on the stack.
        await client.send(IpcCommand.DEBUG_BREAKPOINT_ADD, {
            addr: breakpointAddress, memPages: 0x1FFFFFFFF, status: 'ACTIVE',
            autoDelete: false, operand: 'A', condition: 'ANY', value: 0, comment: 'probe',
        });
        await client.send(IpcCommand.RUN);

        // Wait for the breakpoint stop.
        let running = true;
        for (let poll = 0; poll < 200 && running; poll++) {
            await new Promise(resolve => setTimeout(resolve, 10));
            const state = await client.send<any>(IpcCommand.IS_RUNNING);
            running = state.data?.isRunning === true;
        }
        expect(running).to.equal(false, 'emulator did not stop at the accumulate breakpoint');

        const regs = (await client.send<any>(IpcCommand.GET_REGS)).data;
        const context = DebugStopContext.from(metadata, client, regs);

        // The top frame is accumulate; CFI should recover main as the caller.
        const frames = await context.unwind();
        expect(frames.length).to.be.greaterThanOrEqual(2);
        expect(frames[0].pc).to.equal(breakpointAddress);
        expect(frames[1].pc).to.be.a('number');

        // Evaluate the top frame's register state through the DWARF map.
        expect(frames[0].registers[DWARF_REG.SP]).to.equal(regs.sp);
        expect(frames[0].registers[DWARF_REG.PC]).to.equal(regs.pc);

        await client.send(IpcCommand.DEBUG_BREAKPOINT_DEL, { addr: breakpointAddress });
    });
});
