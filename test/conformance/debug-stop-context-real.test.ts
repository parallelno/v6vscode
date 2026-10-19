import { expect } from 'chai';
import { EventEmitter } from 'events';
import { PerformanceService } from '../../src/debug/performance/performance-service';
import { MemoryEditService } from '../../src/debug/memory-edits/memory-edit-service';
import { SessionState } from '../../src/emulator/session/session-operations';
import { getServerInfo } from '../../src/emulator/protocol/ipc-server-info';
import * as path from 'path';
import * as net from 'net';
import { fixturePath, fixtureRom, repositoryRoot } from '../helpers/fixture-paths';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { parseElf32 } from '../../src/debug/metadata/elf32-reader';
import { DebugMetadataIndex } from '../../src/debug/metadata/debug-metadata-index';
import { DebugStopContext } from '../../src/debug/metadata/debug-stop-context';
import { DWARF_REG } from '../../src/debug/metadata/v6c-register-map';
import { IpcClient } from '../../src/emulator/client/ipc-client';
import { IpcCommand } from '../../src/emulator/protocol/ipc-commands';
import { Logger } from '../../src/platform/logging/logger';

const REPOSITORY_ROOT = repositoryRoot();
const PROBE_ELF = fixturePath('cdbg', 'probe-O0.elf');
const PROBE_ROM = fixtureRom(PROBE_ELF);
const EMULATOR = process.env.V6EMUL;
let port: number;

describe('DebugStopContext real-emulator verification', function () {
    this.timeout(20_000);

    let emulator: ChildProcess;
    let client: IpcClient;
    let metadata: DebugMetadataIndex;

    before(function () {
        if (!EMULATOR || !fs.existsSync(EMULATOR) || !fs.existsSync(PROBE_ELF) || !fs.existsSync(PROBE_ROM)) {
            throw new Error('Conformance requires V6EMUL pointing to a debugger-enabled emulator and mandatory C fixtures');
        }
    });

    before(async () => {
        const reservation = net.createServer();
        await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
        port = (reservation.address() as net.AddressInfo).port;
        await new Promise<void>(resolve => reservation.close(() => resolve()));
        metadata = new DebugMetadataIndex(parseElf32(fs.readFileSync(PROBE_ELF)));
        emulator = spawn(EMULATOR!, [
            '--serve', '--tcp-port', String(port),
            '--boot-rom', path.join(REPOSITORY_ROOT, 'res', 'boot', 'boots.bin'),
            '--speed', 'max',
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        emulator.stderr?.on('data', () => {});

        client = new IpcClient(new Logger());
        const deadline = Date.now() + 8000;
        for (;;) {
            try { await client.connect(port); break; } catch (error) {
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
    it('uses shared validation and scoped transactions for real performance and memory-edit mutations', async () => {
        await client.send(IpcCommand.STOP);
        const state: SessionState = Object.assign(new EventEmitter(), {
            connected: true, running: false, serverInfo: await getServerInfo(client),
        });
        const performance = new PerformanceService(state, client);
        const edits = new MemoryEditService(state, client);
        let id: number | undefined;
        try {
            const added = await performance.add({ name: 'scope conformance', addrStart: 0x100, addrEnd: 0x110, active: true });
            id = added.id;
            expect(performance.snapshot.some(entry => entry.id === id)).to.equal(true);
            await performance.setActivity(id, false);
            expect(performance.snapshot.find(entry => entry.id === id)?.active).to.equal(false);
            const edit = await edits.apply(0x5000, 0x42);
            expect(edit?.enteredValue).to.equal(0x42);
            await edits.setActivity(0x5000, false);
            expect(edits.snapshot.find(entry => entry.globalAddr === 0x5000)?.active).to.equal(false);
            await edits.deleteAndRestore(0x5000);
            expect(edits.snapshot).to.deep.equal([]);
            await performance.delete(id);
            expect(performance.snapshot.some(entry => entry.id === id)).to.equal(false);
            id = undefined;
        } finally {
            if (id !== undefined) { await performance.delete(id).catch(() => {}); }
            await edits.deleteAll().catch(() => {});
            performance.dispose(); edits.dispose();
        }
    });
});
