import * as net from 'net';
import * as vscode from 'vscode';
import { IpcClient } from '../../emulator/client/ipc-client';
import { V6emulLocator } from '../../emulator/launcher/v6emul-locator';
import { V6emulLauncher, EmulatorProcess } from '../../emulator/launcher/v6emul-launcher';
import {
    IpcCommand,
    GetRegsResponse,
    IsRunningResponse,
    PingResponse,
} from '../../emulator/protocol/ipc-commands';
import {
    makeBreakpointAdd,
    BreakpointEntry,
    decodeBpAddr,
    GetStepOverAddrResponse,
    GetStackSampleResponse,
    StopReason,
} from '../../emulator/protocol/debug-models';
import { Logger } from '../../platform/logging/logger';
import { PathService } from '../../platform/files/path-service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THREAD_ID = 1;
const THREAD_NAME = 'V6 CPU';
const POLL_INTERVAL_MS = 20;
const CONNECT_RETRIES = 15;
const CONNECT_DELAY_MS = 300;

// variablesReference identifiers — non-zero means expandable
const VARREF_REGISTERS = 1;
const VARREF_FLAGS = 2;
const VARREF_STACK = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex4(n: number): string { return `0x${(n >>> 0).toString(16).padStart(4, '0').toUpperCase()}`; }
function hex2(n: number): string { return `0x${(n >>> 0).toString(16).padStart(2, '0').toUpperCase()}`; }

function flag(f: number, bit: number): string { return (f >> bit & 1) ? '1' : '0'; }

async function findFreePort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
            const port = (srv.address() as net.AddressInfo).port;
            srv.close(() => resolve(port));
        });
        srv.on('error', reject);
    });
}

async function delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// V6DebugAdapter
// ---------------------------------------------------------------------------

/**
 * In-process DAP adapter for the Vector-06C emulator.
 *
 * Implements vscode.DebugAdapter — VS Code calls handleMessage() for every
 * incoming DAP message and listens on onDidSendMessage for outgoing messages.
 *
 * Capabilities enabled in this implementation (Steps 3.8 / 3.9 / 3.11 / 3.12):
 *   - launch (own emulator process) and attach (existing server)
 *   - stopOnEntry
 *   - continue, pause, stepIn, next (step-over via GET_STEP_OVER_ADDR)
 *   - threads, stackTrace, scopes, variables (registers + flags + raw stack)
 *   - setInstructionBreakpoints (direct address, working backend protocol)
 *   - setBreakpoints (returned as unverified — ELF/DWARF not yet consumed)
 *   - evaluate (register names and hex literals)
 *   - IS_RUNNING poll → StoppedEvent (Step 3.3 stop-info will refine reasons)
 */
export class V6DebugAdapter implements vscode.DebugAdapter {
    private readonly _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    readonly onDidSendMessage = this._onDidSendMessage.event;

    // IPC
    private client: IpcClient | null = null;
    private emulatorProcess: EmulatorProcess | null = null;

    // Session state
    private initialized = false;
    private sessionState: 'idle' | 'running' | 'paused' | 'disconnected' = 'idle';
    private stopReason: StopReason = 'entry';
    private pendingPause = false;
    private pendingStep = false;
    private pendingStepOverAddr: number | undefined;

    // IS_RUNNING poll
    private pollTimer: NodeJS.Timeout | null = null;
    private pollingActive = false;

    // Breakpoint tracking: DAP breakpoint ID → CPU address
    private nextBpId = 1;
    private bpAddrToId = new Map<number, number>();
    private bpIdToAddr = new Map<number, number>();

    // Frame-level cache — refreshed on each pause
    private cachedRegs: GetRegsResponse | null = null;

    constructor(
        private readonly locator: V6emulLocator,
        private readonly launcher: V6emulLauncher,
        private readonly logger: Logger,
        private readonly pathService: PathService,
        private readonly getConfiguration: (s: string) => vscode.WorkspaceConfiguration,
    ) {}

    // -----------------------------------------------------------------------
    // vscode.DebugAdapter interface
    // -----------------------------------------------------------------------

    handleMessage(message: vscode.DebugProtocolMessage): void {
        const msg = message as any;
        if (msg.type === 'request') {
            this.dispatchRequest(msg).catch(err => {
                this.logger.error(`v6-debug: unhandled error in ${msg.command}: ${err}`);
            });
        }
    }

    dispose(): void {
        this.cleanup(false);
        this._onDidSendMessage.dispose();
    }

    // -----------------------------------------------------------------------
    // Request dispatch
    // -----------------------------------------------------------------------

    private async dispatchRequest(req: any): Promise<void> {
        switch (req.command) {
            case 'initialize':           await this.onInitialize(req); break;
            case 'launch':               await this.onLaunch(req); break;
            case 'attach':               await this.onAttach(req); break;
            case 'configurationDone':    await this.onConfigurationDone(req); break;
            case 'threads':              await this.onThreads(req); break;
            case 'stackTrace':           await this.onStackTrace(req); break;
            case 'scopes':               await this.onScopes(req); break;
            case 'variables':            await this.onVariables(req); break;
            case 'continue':             await this.onContinue(req); break;
            case 'pause':                await this.onPause(req); break;
            case 'next':                 await this.onNext(req); break;
            case 'stepIn':               await this.onStepIn(req); break;
            case 'setBreakpoints':       await this.onSetBreakpoints(req); break;
            case 'setInstructionBreakpoints': await this.onSetInstructionBreakpoints(req); break;
            case 'evaluate':             await this.onEvaluate(req); break;
            case 'disconnect':           await this.onDisconnect(req); break;
            case 'terminate':            await this.onTerminate(req); break;
            default:
                this.sendResponse(req, false, `Unsupported command: ${req.command}`);
        }
    }

    // -----------------------------------------------------------------------
    // initialize
    // -----------------------------------------------------------------------

    private async onInitialize(req: any): Promise<void> {
        this.initialized = true;
        this.sendResponseBody(req, {
            supportsConfigurationDoneRequest: true,
            supportsStepInTargetsRequest: false,
            supportsSetVariable: false,
            supportsEvaluateForHovers: true,
            supportsInstructionBreakpoints: true,
            supportsBreakpointLocationsRequest: false,
            supportsTerminateRequest: true,
            supportTerminateDebuggee: true,
            supportsRestartRequest: false,
        });
        // Advertise that we're ready for breakpoints
        this.sendEvent('initialized');
    }

    // -----------------------------------------------------------------------
    // launch
    // -----------------------------------------------------------------------

    private async onLaunch(req: any): Promise<void> {
        const args = req.arguments ?? {};
        try {
            const port = await findFreePort();
            const emulatorPath = this.locator.resolve();
            const bootRomPath = args.bootRom
                ? String(args.bootRom)
                : this.pathService.resolveExtensionPath('res/boot/boots.bin');

            const isRom = !String(args.program ?? '').endsWith('.fdd');

            this.emulatorProcess = this.launcher.launch({
                emulatorPath,
                tcpPort: port,
                bootRomPath,
                romPath: isRom ? String(args.program) : undefined,
                loadAddr: args.loadAddress ? String(args.loadAddress) : undefined,
                fddPath: !isRom ? String(args.program) : undefined,
                fddAutoboot: !isRom ? true : undefined,
                speed: args.speed ?? '100%',
            });

            this.emulatorProcess.spawnResult.exitPromise.then(code => {
                this.logger.info(`v6emul exited with code ${code}`);
                if (this.sessionState !== 'disconnected') {
                    this.sessionState = 'disconnected';
                    this.stopPoll();
                    this.sendEvent('exited', { exitCode: code ?? 0 });
                    this.sendEvent('terminated');
                }
            }).catch(() => {});

            const client = new IpcClient(this.logger);
            await this.connectWithRetries(client, port);
            this.client = client;

            // Health check
            const ping = await client.send<PingResponse>(IpcCommand.PING);
            if (!ping.ok) {
                throw new Error('PING failed');
            }

            // Attach debugger
            await client.send(IpcCommand.DEBUG_ATTACH, { data: true });

            // Keep paused until configurationDone
            await client.send(IpcCommand.STOP);
            this.sessionState = 'paused';

            this.sendResponseBody(req, {});
        } catch (err: any) {
            this.sendResponse(req, false, `Launch failed: ${err.message}`);
            this.cleanup(false);
        }
    }

    // -----------------------------------------------------------------------
    // attach
    // -----------------------------------------------------------------------

    private async onAttach(req: any): Promise<void> {
        const args = req.arguments ?? {};
        try {
            const port = Number(args.port ?? 9876);
            const host = String(args.host ?? '127.0.0.1');
            const client = new IpcClient(this.logger);
            await client.connect(port, host);
            this.client = client;

            const ping = await client.send<PingResponse>(IpcCommand.PING);
            if (!ping.ok) {
                throw new Error('PING failed');
            }

            await client.send(IpcCommand.DEBUG_ATTACH, { data: true });
            await client.send(IpcCommand.STOP);
            this.sessionState = 'paused';

            this.sendResponseBody(req, {});
        } catch (err: any) {
            this.sendResponse(req, false, `Attach failed: ${err.message}`);
        }
    }

    // -----------------------------------------------------------------------
    // configurationDone — breakpoints have been sent; start or remain paused
    // -----------------------------------------------------------------------

    private async onConfigurationDone(req: any): Promise<void> {
        this.sendResponseBody(req, {});

        // stopOnEntry: remain paused and emit stopped event
        // otherwise start running
        const launchArgs = (this as any)._lastLaunchArgs ?? {};
        if (launchArgs.stopOnEntry) {
            this.stopReason = 'entry';
            await this.refreshRegs();
            this.emitStopped('entry');
        } else {
            await this.run();
        }
    }

    // -----------------------------------------------------------------------
    // threads
    // -----------------------------------------------------------------------

    private async onThreads(req: any): Promise<void> {
        this.sendResponseBody(req, {
            threads: [{ id: THREAD_ID, name: THREAD_NAME }],
        });
    }

    // -----------------------------------------------------------------------
    // stackTrace
    // -----------------------------------------------------------------------

    private async onStackTrace(req: any): Promise<void> {
        const regs = await this.safeGetRegs();
        const pc = regs?.pc ?? 0;
        const frame = {
            id: 1,
            name: hex4(pc),
            instructionPointerReference: hex4(pc),
            line: 0,
            column: 0,
            // source is omitted until ELF/DWARF consumer (Step 3.10) is available
        };
        this.sendResponseBody(req, {
            stackFrames: [frame],
            totalFrames: 1,
        });
    }

    // -----------------------------------------------------------------------
    // scopes
    // -----------------------------------------------------------------------

    private async onScopes(req: any): Promise<void> {
        this.sendResponseBody(req, {
            scopes: [
                {
                    name: 'Registers',
                    variablesReference: VARREF_REGISTERS,
                    expensive: false,
                    presentationHint: 'registers',
                },
                {
                    name: 'Flags',
                    variablesReference: VARREF_FLAGS,
                    expensive: false,
                },
                {
                    name: 'Raw Stack',
                    variablesReference: VARREF_STACK,
                    expensive: false,
                },
            ],
        });
    }

    // -----------------------------------------------------------------------
    // variables
    // -----------------------------------------------------------------------

    private async onVariables(req: any): Promise<void> {
        const ref = req.arguments?.variablesReference ?? 0;
        const regs = await this.safeGetRegs();

        if (!regs) {
            this.sendResponseBody(req, { variables: [] });
            return;
        }

        const a = (regs.af >> 8) & 0xFF;
        const f = regs.af & 0xFF;
        const b = (regs.bc >> 8) & 0xFF;
        const c = regs.bc & 0xFF;
        const d = (regs.de >> 8) & 0xFF;
        const e = regs.de & 0xFF;
        const h = (regs.hl >> 8) & 0xFF;
        const l = regs.hl & 0xFF;

        if (ref === VARREF_REGISTERS) {
            this.sendResponseBody(req, {
                variables: [
                    mkVar('A',  hex2(a),         0, 'register'),
                    mkVar('F',  hex2(f),         0, 'register'),
                    mkVar('B',  hex2(b),         0, 'register'),
                    mkVar('C',  hex2(c),         0, 'register'),
                    mkVar('D',  hex2(d),         0, 'register'),
                    mkVar('E',  hex2(e),         0, 'register'),
                    mkVar('H',  hex2(h),         0, 'register'),
                    mkVar('L',  hex2(l),         0, 'register'),
                    mkVar('AF', hex4(regs.af),   0, 'register'),
                    mkVar('BC', hex4(regs.bc),   0, 'register'),
                    mkVar('DE', hex4(regs.de),   0, 'register'),
                    mkVar('HL', hex4(regs.hl),   0, 'register'),
                    mkVar('SP', hex4(regs.sp),   0, 'register'),
                    mkVar('PC', hex4(regs.pc),   0, 'register'),
                    mkVar('M',  hex2(regs.m),    0, 'register'),
                ],
            });
        } else if (ref === VARREF_FLAGS) {
            // 8080 F register: S=bit7 Z=bit6 AC=bit4 P=bit2 CY=bit0
            this.sendResponseBody(req, {
                variables: [
                    mkVar('S  (Sign)',          flag(f, 7), 0),
                    mkVar('Z  (Zero)',          flag(f, 6), 0),
                    mkVar('AC (Aux Carry)',      flag(f, 4), 0),
                    mkVar('P  (Parity)',         flag(f, 2), 0),
                    mkVar('CY (Carry)',          flag(f, 0), 0),
                ],
            });
        } else if (ref === VARREF_STACK) {
            const stackVars = await this.buildStackVars(regs.sp);
            this.sendResponseBody(req, { variables: stackVars });
        } else {
            this.sendResponseBody(req, { variables: [] });
        }
    }

    private async buildStackVars(sp: number): Promise<any[]> {
        const vars: any[] = [];
        try {
            const resp = await this.client!.send<GetStackSampleResponse>(IpcCommand.GET_STACK_SAMPLE);
            if (resp.ok && resp.data?.data) {
                const words = resp.data.data;
                for (let i = 0; i < words.length; i++) {
                    const addr = (sp - (words.length / 2 - i) * 2 + 0x10000) & 0xFFFF;
                    const label = addr === sp ? `[SP] ${hex4(addr)}` : hex4(addr);
                    vars.push(mkVar(label, hex4(words[i]), 0));
                }
            }
        } catch {}
        return vars;
    }

    // -----------------------------------------------------------------------
    // continue
    // -----------------------------------------------------------------------

    private async onContinue(req: any): Promise<void> {
        this.sendResponseBody(req, { allThreadsContinued: true });
        await this.run();
    }

    private async run(): Promise<void> {
        if (!this.client) { return; }
        this.cachedRegs = null;
        this.pendingPause = false;
        this.pendingStep = false;
        this.sessionState = 'running';
        await this.client.send(IpcCommand.RUN);
        this.sendEvent('continued', { threadId: THREAD_ID, allThreadsContinued: true });
        this.startPoll();
    }

    // -----------------------------------------------------------------------
    // pause
    // -----------------------------------------------------------------------

    private async onPause(req: any): Promise<void> {
        this.pendingPause = true;
        await this.client?.send(IpcCommand.STOP);
        this.sendResponseBody(req, {});
        // Poll will detect the stop and emit StoppedEvent
    }

    // -----------------------------------------------------------------------
    // next (step over)
    // -----------------------------------------------------------------------

    private async onNext(req: any): Promise<void> {
        if (!this.client) { this.sendResponseBody(req, {}); return; }

        this.sendResponseBody(req, {});
        this.pendingStep = true;
        this.cachedRegs = null;

        try {
            // Ask backend for step-over address (address after current instruction / CALL target)
            const soResp = await this.client.send<GetStepOverAddrResponse>(IpcCommand.GET_STEP_OVER_ADDR);
            const soAddr = soResp.ok && soResp.data ? soResp.data.addr : 0;

            if (soAddr > 0 && soAddr !== 0xFFFF) {
                // Set a temporary auto-delete breakpoint at the step-over address
                this.pendingStepOverAddr = soAddr;
                await this.client.send(IpcCommand.DEBUG_BREAKPOINT_ADD,
                    makeBreakpointAdd(soAddr, '__dap_next', true));
                await this.run();
            } else {
                // Fallback: single instruction step
                await this.singleStep();
            }
        } catch {
            await this.singleStep();
        }
    }

    // -----------------------------------------------------------------------
    // stepIn
    // -----------------------------------------------------------------------

    private async onStepIn(req: any): Promise<void> {
        this.sendResponseBody(req, {});
        this.pendingStep = true;
        this.cachedRegs = null;
        await this.singleStep();
    }

    private async singleStep(): Promise<void> {
        if (!this.client) { return; }
        this.sessionState = 'running';
        this.sendEvent('continued', { threadId: THREAD_ID, allThreadsContinued: true });
        await this.client.send(IpcCommand.EXECUTE_INSTR);
        // EXECUTE_INSTR keeps the emulator paused — read stop state immediately
        this.sessionState = 'paused';
        await this.onStop();
    }

    // -----------------------------------------------------------------------
    // setBreakpoints — source breakpoints (Step 3.11 full impl requires ELF/DWARF)
    // -----------------------------------------------------------------------

    private async onSetBreakpoints(req: any): Promise<void> {
        const args = req.arguments ?? {};
        const sourceBreakpoints = args.breakpoints ?? [];

        // Return all as unverified until the ELF/DWARF consumer (Step 3.10) is in place.
        const breakpoints = sourceBreakpoints.map((_bp: any, i: number) => ({
            id: this.nextBpId++,
            verified: false,
            message: 'Source breakpoints require a debug artifact (ELF companion). Set debugArtifact in launch.json.',
            line: _bp.line,
        }));

        this.sendResponseBody(req, { breakpoints });
    }

    // -----------------------------------------------------------------------
    // setInstructionBreakpoints — direct address breakpoints (working now)
    // -----------------------------------------------------------------------

    private async onSetInstructionBreakpoints(req: any): Promise<void> {
        if (!this.client) {
            this.sendResponseBody(req, { breakpoints: [] });
            return;
        }

        const args = req.arguments ?? {};
        const desired: number[] = (args.breakpoints ?? []).map((bp: any) => {
            const ref = String(bp.instructionReference ?? '0x0');
            return parseInt(ref, 16) & 0xFFFF;
        });

        // Remove breakpoints that are no longer desired
        const current = new Set(this.bpAddrToId.keys());
        for (const addr of current) {
            if (!desired.includes(addr)) {
                await this.client.send(IpcCommand.DEBUG_BREAKPOINT_DEL, { addr }).catch(() => {});
                const id = this.bpAddrToId.get(addr)!;
                this.bpAddrToId.delete(addr);
                this.bpIdToAddr.delete(id);
            }
        }

        // Add newly requested breakpoints
        const result: any[] = [];
        for (const addr of desired) {
            let id = this.bpAddrToId.get(addr);
            if (!id) {
                id = this.nextBpId++;
                const addResp = await this.client.send(
                    IpcCommand.DEBUG_BREAKPOINT_ADD,
                    makeBreakpointAdd(addr, `dap:${id}`),
                ).catch(() => ({ ok: false }));

                if (addResp.ok) {
                    this.bpAddrToId.set(addr, id);
                    this.bpIdToAddr.set(id, addr);
                    result.push({ id, verified: true, instructionReference: hex4(addr) });
                } else {
                    result.push({
                        id,
                        verified: false,
                        message: 'Failed to set breakpoint in emulator.',
                        instructionReference: hex4(addr),
                    });
                }
            } else {
                result.push({ id, verified: true, instructionReference: hex4(addr) });
            }
        }

        this.sendResponseBody(req, { breakpoints: result });
    }

    // -----------------------------------------------------------------------
    // evaluate — register names and hex literals
    // -----------------------------------------------------------------------

    private async onEvaluate(req: any): Promise<void> {
        const expr = String(req.arguments?.expression ?? '').trim().toUpperCase();
        const regs = await this.safeGetRegs();

        if (regs) {
            const val = this.evalExpression(expr, regs);
            if (val !== undefined) {
                this.sendResponseBody(req, {
                    result: typeof val === 'number' ? hex4(val) : val,
                    variablesReference: 0,
                });
                return;
            }
        }

        this.sendResponse(req, false, `Cannot evaluate: ${req.arguments?.expression}`);
    }

    private evalExpression(expr: string, regs: GetRegsResponse): number | undefined {
        const map: Record<string, number> = {
            A:  (regs.af >> 8) & 0xFF,
            F:  regs.af & 0xFF,
            B:  (regs.bc >> 8) & 0xFF,
            C:  regs.bc & 0xFF,
            D:  (regs.de >> 8) & 0xFF,
            E:  regs.de & 0xFF,
            H:  (regs.hl >> 8) & 0xFF,
            L:  regs.hl & 0xFF,
            AF: regs.af,
            BC: regs.bc,
            DE: regs.de,
            HL: regs.hl,
            SP: regs.sp,
            PC: regs.pc,
            M:  regs.m,
        };
        if (expr in map) { return map[expr]; }

        // Hex literal: 0x..., $..., or decimal
        const hexMatch = expr.match(/^(?:0X([0-9A-F]+)|\$([0-9A-F]+))$/);
        if (hexMatch) { return parseInt(hexMatch[1] ?? hexMatch[2], 16); }
        if (/^\d+$/.test(expr)) { return parseInt(expr, 10); }

        return undefined;
    }

    // -----------------------------------------------------------------------
    // disconnect / terminate
    // -----------------------------------------------------------------------

    private async onDisconnect(req: any): Promise<void> {
        const terminateDebuggee = req.arguments?.terminateDebuggee ?? (this.emulatorProcess !== null);
        this.sendResponseBody(req, {});
        await this.cleanup(terminateDebuggee);
    }

    private async onTerminate(req: any): Promise<void> {
        this.sendResponseBody(req, {});
        await this.cleanup(true);
    }

    // -----------------------------------------------------------------------
    // IS_RUNNING poll
    // -----------------------------------------------------------------------

    private startPoll(): void {
        this.stopPoll();
        this.pollingActive = true;
        const poll = async () => {
            if (!this.pollingActive || !this.client) { return; }
            try {
                const resp = await this.client.send<IsRunningResponse>(IpcCommand.IS_RUNNING);
                if (resp.ok && resp.data && !resp.data.isRunning) {
                    this.pollingActive = false;
                    this.pollTimer = null;
                    this.sessionState = 'paused';
                    await this.onStop();
                    return;
                }
            } catch {
                this.pollingActive = false;
                this.pollTimer = null;
                return;
            }
            if (this.pollingActive) {
                this.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
            }
        };
        this.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    private stopPoll(): void {
        this.pollingActive = false;
        if (this.pollTimer !== null) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    // -----------------------------------------------------------------------
    // Stop handling
    // -----------------------------------------------------------------------

    private async onStop(): Promise<void> {
        // Clean up any pending step-over breakpoint that was not auto-deleted
        if (this.pendingStepOverAddr !== undefined) {
            await this.client?.send(IpcCommand.DEBUG_BREAKPOINT_DEL, {
                addr: this.pendingStepOverAddr,
            }).catch(() => {});
            this.pendingStepOverAddr = undefined;
        }

        await this.refreshRegs();
        const pc = this.cachedRegs?.pc;
        let reason: StopReason = 'pause';
        let hitBreakpointIds: number[] | undefined;

        if (this.pendingStep) {
            reason = 'step';
            this.pendingStep = false;
        } else if (this.pendingPause) {
            reason = 'pause';
            this.pendingPause = false;
        } else if (pc !== undefined) {
            const bpId = this.bpAddrToId.get(pc);
            if (bpId !== undefined) {
                reason = 'breakpoint';
                hitBreakpointIds = [bpId];
            }
        }

        this.stopReason = reason;
        this.emitStopped(reason, hitBreakpointIds);
    }

    private emitStopped(reason: StopReason, hitBreakpointIds?: number[]): void {
        this.sendEvent('stopped', {
            reason,
            threadId: THREAD_ID,
            allThreadsStopped: true,
            hitBreakpointIds,
        });
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private async refreshRegs(): Promise<void> {
        if (!this.client) { return; }
        try {
            const resp = await this.client.send<GetRegsResponse>(IpcCommand.GET_REGS);
            if (resp.ok && resp.data) {
                this.cachedRegs = resp.data;
            }
        } catch {}
    }

    private async safeGetRegs(): Promise<GetRegsResponse | null> {
        if (this.cachedRegs) { return this.cachedRegs; }
        await this.refreshRegs();
        return this.cachedRegs;
    }

    private async connectWithRetries(client: IpcClient, port: number): Promise<void> {
        for (let i = 0; i < CONNECT_RETRIES; i++) {
            try {
                await client.connect(port);
                return;
            } catch {
                if (i === CONNECT_RETRIES - 1) { throw new Error(`Cannot connect to v6emul on port ${port}`); }
                await delay(CONNECT_DELAY_MS);
            }
        }
    }

    private async cleanup(terminateDebuggee: boolean): Promise<void> {
        this.stopPoll();
        this.sessionState = 'disconnected';

        // Remove all DAP-owned breakpoints
        if (this.client?.connected) {
            for (const addr of this.bpAddrToId.keys()) {
                await this.client.send(IpcCommand.DEBUG_BREAKPOINT_DEL, { addr }).catch(() => {});
            }
            await this.client.send(IpcCommand.DEBUG_ATTACH, { data: false }).catch(() => {});
            if (terminateDebuggee) {
                await this.client.send(IpcCommand.EXIT, {}).catch(() => {});
            }
            this.client.disconnect();
        }

        this.bpAddrToId.clear();
        this.bpIdToAddr.clear();
        this.client = null;
        this.emulatorProcess = null;
        this.cachedRegs = null;
    }

    // -----------------------------------------------------------------------
    // DAP message helpers
    // -----------------------------------------------------------------------

    private sendResponseBody(req: any, body: any): void {
        this._onDidSendMessage.fire({
            type: 'response',
            request_seq: req.seq,
            success: true,
            command: req.command,
            body,
        } as any);
    }

    private sendResponse(req: any, success: boolean, message?: string): void {
        this._onDidSendMessage.fire({
            type: 'response',
            request_seq: req.seq,
            success,
            command: req.command,
            message,
            body: {},
        } as any);
    }

    private sendEvent(event: string, body?: any): void {
        this._onDidSendMessage.fire({
            type: 'event',
            event,
            body: body ?? {},
        } as any);
    }
}

// ---------------------------------------------------------------------------
// Variable builder helper
// ---------------------------------------------------------------------------

function mkVar(name: string, value: string, variablesReference: number, presentationHint?: string): any {
    const v: any = { name, value, variablesReference };
    if (presentationHint) { v.presentationHint = { kind: presentationHint }; }
    return v;
}
