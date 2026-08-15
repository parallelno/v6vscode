import * as path from 'path';
import * as vscode from 'vscode';
import { IpcClient } from '../../emulator/client/ipc-client';
import { EmulatorProcess } from '../../emulator/launcher/v6emul-launcher';
import { DebugLaunchRequest, EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { EmulatorPanel } from '../../emulator/panel/emulator-panel';
import {
    DebugResetRequest,
    IpcCommand,
    GetRegsResponse,
    IsRunningResponse,
    PingResponse,
} from '../../emulator/protocol/ipc-commands';
import {
    BreakpointOperand,
    BreakpointEntry,
    DebugCondition,
    makeBreakpointAdd,
    decodeStopRecord,
    GetStepOverAddrResponse,
    GetStackSampleResponse,
    StopRecord,
    StopReason,
} from '../../emulator/protocol/debug-models';
import { loadDebugArtifact } from '../metadata/debug-artifact-loader';
import { DebugIndex, SourceLocation } from '../metadata/debug-index';
import { resolveDebugSourcePath } from '../metadata/debug-source-path';
import { Logger } from '../../platform/logging/logger';
import { PathService } from '../../platform/files/path-service';
import { getServerInfo, supportsStopRecords, validateDebuggerServer } from '../../emulator/protocol/ipc-server-info';
import { WatchpointService } from '../watchpoints/watchpoint-service';
import { evaluateSymbolExpression, validateSymbolExpression } from '../utilities/symbol-expression';
import { WatchpointsProvider } from '../views/watchpoints-provider';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THREAD_ID = 1;
const THREAD_NAME = 'V6 CPU';
const POLL_INTERVAL_MS = 20;

// variablesReference identifiers — non-zero means expandable
const VARREF_REGISTERS = 1;
const VARREF_FLAGS = 2;
const VARREF_STACK = 3;
const BYTE_REGISTER_EXPRESSIONS = new Set(['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L', 'M']);
const BYTE_BREAKPOINT_OPERANDS = new Set<BreakpointOperand>(['A', 'F', 'B', 'C', 'D', 'E', 'H', 'L']);
const WORD_BREAKPOINT_OPERANDS = new Set<BreakpointOperand>(['BC', 'DE', 'HL', 'SP']);
const BREAKPOINT_OPERANDS = new Set<BreakpointOperand>([
    'A', 'F', 'B', 'C', 'D', 'E', 'H', 'L', 'BC', 'DE', 'HL', 'SP',
]);
const CONDITION_OPERATORS: ReadonlyArray<readonly [string, DebugCondition]> = [
    ['==', 'EQU'], ['!=', 'NOT_EQU'], ['<=', 'LESS_EQU'], ['>=', 'GREATER_EQU'],
    ['<', 'LESS'], ['>', 'GREATER'],
];

interface ParsedBreakpointCondition {
    operand: BreakpointOperand;
    condition: DebugCondition;
    value: number;
    text: string;
}

type LogMessageSegment = { literal: string } | { expression: string };

interface ParsedLogMessage {
    text: string;
    segments: readonly LogMessageSegment[];
}

interface AdapterBreakpoint {
    id: number;
    address: number;
    condition?: ParsedBreakpointCondition;
    hitCondition?: number;
    logMessage?: ParsedLogMessage;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hex4(n: number): string { return `0x${(n >>> 0).toString(16).padStart(4, '0').toUpperCase()}`; }
function hex2(n: number): string { return `0x${(n >>> 0).toString(16).padStart(2, '0').toUpperCase()}`; }

function flag(f: number, bit: number): string { return (f >> bit & 1) ? '1' : '0'; }

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
 *   - authoritative stop-record polling with IS_RUNNING fallback
 */
export class V6DebugAdapter implements vscode.DebugAdapter {
    private readonly _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    readonly onDidSendMessage = this._onDidSendMessage.event;

    // IPC
    private client: IpcClient | null = null;
    private emulatorProcess: EmulatorProcess | null = null;

    // Debug metadata
    private debugIndex: DebugIndex | null = null;
    private debugMetadataError = 'No debug artifact was configured in the active project.';
    private workspaceRoot = '';
    private lastResolvedSource: SourceLocation | undefined;
    private unavailableSourceDecoration: vscode.TextEditorDecorationType | undefined;

    // Session state
    private initialized = false;
    private sessionState: 'idle' | 'running' | 'paused' | 'disconnected' = 'idle';
    private stopReason: StopReason = 'entry';
    private pendingPause = false;
    private pendingStep = false;
    private pendingStepOverAddr: number | undefined;
    private terminationEmitted = false;
    private terminationRequested = false;
    private launchRequest: DebugLaunchRequest | null = null;
    private stopOnEntry = false;
    private stopRecordsSupported = false;
    private lastStopSequence: number | undefined;
    private lastExceptionRecord: StopRecord | undefined;

    // IS_RUNNING poll
    private pollTimer: NodeJS.Timeout | null = null;
    private pollingActive = false;

    // Breakpoint tracking: DAP breakpoint ID → CPU address
    private nextBpId = 1;
    private bpAddrToId = new Map<number, number>();
    private bpIdToAddr = new Map<number, number>();
    private breakpointsByAddress = new Map<number, AdapterBreakpoint>();
    private sourceBpAddresses = new Map<string, Set<number>>();
    private instructionBpAddresses = new Set<number>();
    private serverBreakpointIds = new Map<number, number>();
    private watchpointIdToDapId = new Map<number, number>();
    private dapWatchpointIds = new Set<number>();

    // Frame-level cache — refreshed on each pause
    private cachedRegs: GetRegsResponse | null = null;

    constructor(
        private readonly lifecycle: EmulatorLifecycle,
        private readonly emulatorPanel: EmulatorPanel,
        private readonly logger: Logger,
        private readonly pathService: PathService,
        private readonly getConfiguration: (s: string) => vscode.WorkspaceConfiguration,
        private readonly watchpointService?: WatchpointService,
        private readonly watchpointsProvider?: WatchpointsProvider,
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
            case 'dataBreakpointInfo':  await this.onDataBreakpointInfo(req); break;
            case 'setDataBreakpoints':  await this.onSetDataBreakpoints(req); break;
            case 'exceptionInfo':       await this.onExceptionInfo(req); break;
            case 'evaluate':             await this.onEvaluate(req); break;
            case 'restart':              await this.onRestart(req); break;
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
            supportsEvaluateForHovers: false,
            supportsInstructionBreakpoints: true,
            supportsBreakpointEvents: true,
            supportsBreakpointLocationsRequest: false,
            supportsTerminateRequest: true,
            supportTerminateDebuggee: true,
            supportsRestartRequest: true,
            supportsConditionalBreakpoints: true,
            supportsHitConditionalBreakpoints: true,
        });
        // 'initialized' is sent from onLaunch/onAttach after the ELF is loaded,
        // so that VS Code doesn't send setBreakpoints before the debug index is ready.
    }

    // -----------------------------------------------------------------------
    // launch
    // -----------------------------------------------------------------------

    private async onLaunch(req: any): Promise<void> {
        const args = req.arguments ?? {};
        try {
            this.debugIndex = null;
            this.debugMetadataError = 'No debug artifact was configured in the active project.';
            this.lastResolvedSource = undefined;
            this.clearUnavailableSourceIndicator();
            const bootRomPath = args.bootRom
                ? String(args.bootRom)
                : this.pathService.resolveExtensionPath('res/boot/boots.bin');

            this.launchRequest = {
                program: String(args.program),
                bootRomPath,
                loadAddr: args.loadAddress ? String(args.loadAddress) : undefined,
                speed: args.speed ?? '100%',
            };
            this.stopOnEntry = Boolean(args.stopOnEntry);
            const launch = await this.lifecycle.startDebug(this.launchRequest);
            const { client, process, port } = launch;
            this.client = client;
            this.emulatorProcess = process;
            this.stopRecordsSupported = this.lifecycle.serverInfo !== undefined
                && supportsStopRecords(this.lifecycle.serverInfo);
            this.publishDynamicCapabilities();
            process.spawnResult.exitPromise.then(code => {
                this.logger.info(`v6emul exited with code ${code}`);
                if (!this.terminationRequested) {
                    this.emitTerminated(code ?? 0);
                }
            }).catch(() => {});

            // Load debug artifact (companion ELF) if provided
            const debugArtifact = args.debugArtifact as string | undefined;
            if (debugArtifact) {
                const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
                this.workspaceRoot = folder;
                const elfPath = path.isAbsolute(debugArtifact)
                    ? debugArtifact
                    : path.resolve(folder, debugArtifact);
                const romPath = String(args.program ?? '');
                try {
                    const loadResult = await loadDebugArtifact(elfPath, romPath);
                    this.debugIndex = loadResult.index;
                    this.debugMetadataError = '';
                    if (loadResult.validationWarning) {
                        this.sendEvent('output', { category: 'important', output: `V6: ${loadResult.validationWarning}\n` });
                    } else {
                        const fc = loadResult.index.sourceFiles.length;
                        this.sendEvent('output', { category: 'console', output: `V6: Debug metadata loaded — ${fc} source file(s)\n` });
                    }
                } catch (e: any) {
                    this.debugMetadataError = `Could not load debug artifact '${elfPath}': ${e.message}`;
                    this.sendEvent('output', { category: 'important', output: `V6: ${this.debugMetadataError}\n` });
                }
            }

            // Keep paused until configurationDone
            this.sessionState = 'paused';
            this.emulatorPanel.reveal();
            this.sendEvent('output', { category: 'console', output: `V6: Emulator ready on port ${port}; display panel connected to debug session.\n` });

            this.sendResponseBody(req, {});
            // Signal VS Code that breakpoints can now be sent.
            // Must come AFTER the ELF is loaded so debugIndex is ready for setBreakpoints.
            this.sendEvent('initialized');
        } catch (err: any) {
            this.sendResponse(req, false, `Launch failed: ${err.message}`);
            this.cleanup(true);
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

            const serverInfo = await getServerInfo(client);
            validateDebuggerServer(serverInfo);
            this.stopRecordsSupported = supportsStopRecords(serverInfo);
            this.publishDynamicCapabilities();

            const ping = await client.send<PingResponse>(IpcCommand.PING);
            if (!ping.ok) {
                throw new Error('PING failed');
            }

            await client.send(IpcCommand.DEBUG_ATTACH, { data: true });
            await client.send(IpcCommand.STOP);
            this.sessionState = 'paused';

            this.sendResponseBody(req, {});
            this.sendEvent('initialized');
        } catch (err: any) {
            this.sendResponse(req, false, `Attach failed: ${err.message}`);
        }
    }

    // -----------------------------------------------------------------------
    // configurationDone — breakpoints have been sent; start or remain paused
    // -----------------------------------------------------------------------

    private async onConfigurationDone(req: any): Promise<void> {
        try {
            if (this.launchRequest) {
                await this.lifecycle.loadDebugProgram(this.launchRequest);
            }
            this.sendResponseBody(req, {});

            if (this.stopOnEntry) {
                this.stopReason = 'entry';
                await this.refreshRegs();
                this.emitStopped('entry');
            } else {
                await this.run();
            }
        } catch (err: any) {
            this.sendResponse(req, false, `Could not load debug program: ${err.message}`);
            this.cleanup(true);
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

        // Resolve PC to source location using debug index
        const srcLoc = this.debugIndex?.resolveAddress(pc);
        const funcName = this.debugIndex?.symbolAtAddress(pc)?.name;
        const frameName = funcName ? `${funcName} ${hex4(pc)}` : hex4(pc);

        const frame: any = {
            id: 1,
            name: frameName,
            instructionPointerReference: hex4(pc),
            line: 1,
            column: 1,
        };

        if (srcLoc) {
            const sourcePath = resolveDebugSourcePath(srcLoc.file, this.workspaceRoot);
            this.lastResolvedSource = srcLoc;
            this.clearUnavailableSourceIndicator();
            frame.source = {
                path: sourcePath,
                name: path.basename(sourcePath),
                sourceReference: 0,
            };
            frame.line = srcLoc.line;
            frame.column = srcLoc.column;
        } else if (this.debugIndex && this.lastResolvedSource) {
            const sourcePath = resolveDebugSourcePath(this.lastResolvedSource.file, this.workspaceRoot);
            frame.source = {
                path: sourcePath,
                name: path.basename(sourcePath),
                sourceReference: 0,
            };
            frame.line = this.lastResolvedSource.line;
            frame.column = this.lastResolvedSource.column;
            this.showUnavailableSourceIndicator(sourcePath, this.lastResolvedSource.line);
        }

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
                    mkVar('F',  hex2(f),         0, 'register'),
                    mkVar('A',  hex2(a),         0, 'register'),
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
            const resp = await this.client!.send<GetStackSampleResponse>(
                IpcCommand.GET_STACK_SAMPLE,
                { addr: sp },
                5000,
                'high',
            );
            if (resp.ok && resp.data) {
                const offsets = [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10] as const;
                for (const offset of offsets) {
                    const addr = (sp + offset + 0x10000) & 0xFFFF;
                    const label = offset === 0 ? `[SP] ${hex4(addr)}` : hex4(addr);
                    vars.push(mkVar(label, hex4(resp.data[String(offset) as keyof GetStackSampleResponse]), 0));
                }
            }
        } catch (err) {
            this.logger.debug(`v6-debug: stack sample unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
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
        await this.syncServerBreakpoints();
        await this.captureStopBaseline();
        this.watchpointsProvider?.showStop([]);
        this.clearUnavailableSourceIndicator();
        this.cachedRegs = null;
        this.pendingPause = false;
        this.pendingStep = false;
        this.sessionState = 'running';
        await this.client.send(IpcCommand.RUN, undefined, 5000, 'critical');
        this.lifecycle.setExecutionRunning(true);
        this.sendEvent('continued', { threadId: THREAD_ID, allThreadsContinued: true });
        this.startPoll();
    }

    // -----------------------------------------------------------------------
    // pause
    // -----------------------------------------------------------------------

    private async onPause(req: any): Promise<void> {
        this.pendingPause = true;
        await this.client?.send(IpcCommand.STOP, undefined, 5000, 'critical');
        this.lifecycle.setExecutionRunning(false);
        this.sendResponseBody(req, {});
        // Poll will detect the stop and emit StoppedEvent
    }

    // -----------------------------------------------------------------------
    // next (step over)
    // -----------------------------------------------------------------------

    private async onNext(req: any): Promise<void> {
        if (!this.client) { this.sendResponseBody(req, {}); return; }

        this.pendingStep = true;
        this.cachedRegs = null;

        try {
            // Ask backend for step-over address (address after current instruction / CALL target)
            const soResp = await this.client.send<GetStepOverAddrResponse>(IpcCommand.GET_STEP_OVER_ADDR);
            const soAddr = soResp.ok && typeof soResp.data?.data === 'number' ? soResp.data.data : 0;

            if (soAddr > 0 && soAddr !== 0xFFFF) {
                // Set a temporary auto-delete breakpoint at the step-over address
                const addResp = await this.client.send(
                    IpcCommand.DEBUG_BREAKPOINT_ADD,
                    makeBreakpointAdd(soAddr, '__dap_next', { autoDelete: true }),
                );
                if (!addResp.ok) {
                    this.pendingStep = false;
                    this.sendResponse(req, false, addResp.error ?? 'Unable to set the temporary step-over breakpoint');
                    return;
                }
                this.pendingStepOverAddr = soAddr;
                this.sendResponseBody(req, {});
                await this.run();
            } else {
                // Fallback: single instruction step
                this.sendResponseBody(req, {});
                await this.singleStep();
            }
        } catch (error) {
            this.pendingStep = false;
            this.sendResponse(req, false, error instanceof Error ? error.message : String(error));
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
        await this.captureStopBaseline();
        this.sessionState = 'running';
        this.lifecycle.setExecutionRunning(true);
        this.sendEvent('continued', { threadId: THREAD_ID, allThreadsContinued: true });
        await this.client.send(IpcCommand.EXECUTE_INSTR, undefined, 5000, 'critical');
        // EXECUTE_INSTR keeps the emulator paused — read stop state immediately
        this.sessionState = 'paused';
        this.lifecycle.setExecutionRunning(false);
        const record = this.stopRecordsSupported ? await this.readStopRecord() : undefined;
        if (record && record.sequence !== this.lastStopSequence) {
            this.lastStopSequence = record.sequence;
            await this.onStop(record);
        } else if (!this.stopRecordsSupported) {
            await this.onStop();
        }
    }

    // -----------------------------------------------------------------------
    // setBreakpoints — source breakpoints (Step 3.11 full impl requires ELF/DWARF)
    // -----------------------------------------------------------------------

    private parseBreakpointConfiguration(requested: any, allowLogpoint: boolean): Omit<AdapterBreakpoint, 'id' | 'address'> {
        const conditionText = String(requested.condition ?? '').trim();
        const hitText = String(requested.hitCondition ?? '').trim();
        const logMessageText = String(requested.logMessage ?? '');
        if (logMessageText && !allowLogpoint) {
            throw new Error('Logpoints are supported only for source breakpoints.');
        }
        const logMessage = logMessageText ? this.parseLogMessage(logMessageText) : undefined;

        let condition: ParsedBreakpointCondition | undefined;
        if (conditionText) {
            const match = /^([A-Za-z]+)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(conditionText);
            if (!match) {
                throw new Error('Unsupported breakpoint condition. Expected: REGISTER comparison value.');
            }
            const operand = match[1].toUpperCase() as BreakpointOperand;
            if (!BREAKPOINT_OPERANDS.has(operand)) {
                throw new Error(`Unsupported breakpoint register: ${match[1].toUpperCase()}.`);
            }
            const operator = CONDITION_OPERATORS.find(([text]) => text === match[2])?.[1];
            if (!operator) {
                throw new Error('Unsupported breakpoint comparison operator.');
            }
            const value = evaluateSymbolExpression(match[3], name => {
                const symbol = this.debugIndex?.symbol(name);
                if (!symbol) { throw new Error(`Unknown symbol: ${name}`); }
                return symbol.address;
            });
            const max = BYTE_BREAKPOINT_OPERANDS.has(operand) ? 0xFF
                : WORD_BREAKPOINT_OPERANDS.has(operand) ? 0xFFFF : Number.MAX_SAFE_INTEGER;
            if (value < 0 || value > max) {
                throw new Error(`Breakpoint value ${hex4(value)} does not fit register ${operand}.`);
            }
            condition = { operand, condition: operator, value, text: `${operand} ${match[2]} ${match[3].trim()}` };
        }

        let hitCondition: number | undefined;
        if (hitText) {
            if (!/^[1-9][0-9]*$/.test(hitText)) {
                throw new Error('Hit condition must be a positive decimal integer.');
            }
            hitCondition = Number(hitText);
            if (!Number.isSafeInteger(hitCondition)) {
                throw new Error('Hit condition is outside the safe integer range.');
            }
        }
        return { condition, hitCondition, ...(logMessage ? { logMessage } : {}) };
    }

    private parseLogMessage(logMessage: string): ParsedLogMessage {
        const segments: LogMessageSegment[] = [];
        let literal = '';
        const appendLiteral = () => {
            if (literal) { segments.push({ literal }); literal = ''; }
        };
        for (let index = 0; index < logMessage.length; index++) {
            const char = logMessage[index];
            if (char === '{' && logMessage[index + 1] === '{') { literal += '{'; index++; continue; }
            if (char === '}' && logMessage[index + 1] === '}') { literal += '}'; index++; continue; }
            if (char === '}') { throw new Error("Log message contains an unmatched '}'."); }
            if (char !== '{') { literal += char; continue; }
            const end = logMessage.indexOf('}', index + 1);
            if (end < 0) { throw new Error("Log message contains an unmatched '{'."); }
            const expression = logMessage.slice(index + 1, end).trim();
            if (!expression) { throw new Error('Log message contains an empty expression.'); }
            const error = validateSymbolExpression(expression);
            if (error) { throw new Error(`Unsupported logpoint expression: ${expression}.`); }
            appendLiteral();
            segments.push({ expression });
            index = end;
        }
        appendLiteral();
        return { text: logMessage, segments };
    }

    private formatLogMessage(logMessage: ParsedLogMessage): string {
        const registers = this.cachedRegs;
        const values: Record<string, number> = registers ? {
            A: (registers.af >> 8) & 0xFF, F: registers.af & 0xFF,
            B: (registers.bc >> 8) & 0xFF, C: registers.bc & 0xFF,
            D: (registers.de >> 8) & 0xFF, E: registers.de & 0xFF,
            H: (registers.hl >> 8) & 0xFF, L: registers.hl & 0xFF,
            PSW: registers.af, BC: registers.bc, DE: registers.de, HL: registers.hl,
            SP: registers.sp, PC: registers.pc, CC: registers.cc,
        } : {};
        let output = '';
        for (const segment of logMessage.segments) {
            if ('literal' in segment) { output += segment.literal; continue; }
            const expression = segment.expression;
            const value = evaluateSymbolExpression(expression, name => {
                const register = values[name.toUpperCase()];
                if (register !== undefined) { return register; }
                const symbol = this.debugIndex?.symbol(name);
                if (!symbol) { throw new Error(`Unknown symbol: ${name}`); }
                return symbol.address;
            });
            output += BYTE_REGISTER_EXPRESSIONS.has(expression.toUpperCase()) ? hex2(value) : hex4(value);
        }
        return output.endsWith('\n') ? output : `${output}\n`;
    }

    private sameBackendConfiguration(
        first: Pick<AdapterBreakpoint, 'condition' | 'hitCondition'>,
        second: Pick<AdapterBreakpoint, 'condition' | 'hitCondition'>,
    ): boolean {
        return first.hitCondition === second.hitCondition
            && first.condition?.operand === second.condition?.operand
            && first.condition?.condition === second.condition?.condition
            && first.condition?.value === second.condition?.value;
    }

    private sameBreakpointConfiguration(
        first: Pick<AdapterBreakpoint, 'condition' | 'hitCondition' | 'logMessage'>,
        second: Pick<AdapterBreakpoint, 'condition' | 'hitCondition' | 'logMessage'>,
    ): boolean {
        return this.sameBackendConfiguration(first, second)
            && first.logMessage?.text === second.logMessage?.text;
    }

    private hasOtherSourceReference(address: number, sourceKey: string): boolean {
        return [...this.sourceBpAddresses.entries()]
            .some(([key, addresses]) => key !== sourceKey && addresses.has(address));
    }

    private breakpointMessage(breakpoint: AdapterBreakpoint): string {
        const details = [`CPU address: ${hex4(breakpoint.address)}`];
        if (breakpoint.condition) { details.push(`condition: ${breakpoint.condition.text}`); }
        if (breakpoint.hitCondition) { details.push(`hit count: ${breakpoint.hitCondition}`); }
        if (breakpoint.logMessage) { details.push('logpoint'); }
        return details.join('; ');
    }

    private makeBreakpointRequest(breakpoint: AdapterBreakpoint): ReturnType<typeof makeBreakpointAdd> {
        return makeBreakpointAdd(breakpoint.address, `dap:${breakpoint.id}`, {
            operand: breakpoint.condition?.operand,
            condition: breakpoint.condition?.condition,
            value: breakpoint.condition?.value,
            counter: breakpoint.hitCondition,
        });
    }

    private async onSetBreakpoints(req: any): Promise<void> {
        const args = req.arguments ?? {};
        const source: string = args.source?.path ?? args.source?.name ?? '';
        const sourceBreakpoints: any[] = args.breakpoints ?? [];

        if (!this.debugIndex) {
            const breakpoints = sourceBreakpoints.map((_bp: any) => ({
                id: this.nextBpId++,
                verified: false,
                message: this.debugMetadataError,
                line: _bp.line,
            }));
            this.sendResponseBody(req, { breakpoints });
            return;
        }

        if (!source) {
            const breakpoints = sourceBreakpoints.map((_bp: any) => ({
                id: this.nextBpId++,
                verified: false,
                message: 'The breakpoint request did not include a source file path.',
                line: _bp.line,
            }));
            this.sendResponseBody(req, { breakpoints });
            return;
        }

        if (!this.client) { this.sendResponseBody(req, { breakpoints: [] }); return; }

        const sourceKey = process.platform === 'win32'
            ? path.normalize(source).toLowerCase()
            : path.normalize(source);
        const resolvedBreakpoints = sourceBreakpoints.map(bp => ({
            requested: bp,
            resolved: this.debugIndex!.resolveBreakpoint(source, bp.line),
        }));
        const previousAddresses = this.sourceBpAddresses.get(sourceKey) ?? new Set<number>();
        const desiredAddresses = new Set<number>();
        const requestedConfigurations = new Map<number, Omit<AdapterBreakpoint, 'id' | 'address'>>();

        const result: any[] = [];
        for (const { requested: bp, resolved } of resolvedBreakpoints) {
            if (!resolved) {
                result.push({
                    id: this.nextBpId++,
                    verified: false,
                    message: `No executable code at line ${bp.line}`,
                    line: bp.line,
                });
                continue;
            }
            desiredAddresses.add(resolved.address);
            let configuration: Omit<AdapterBreakpoint, 'id' | 'address'>;
            try {
                configuration = this.parseBreakpointConfiguration(bp, true);
            } catch (error) {
                result.push({ id: this.nextBpId++, verified: false, message: String(error instanceof Error ? error.message : error), line: bp.line });
                continue;
            }

            const priorRequest = requestedConfigurations.get(resolved.address);
            if (priorRequest && !this.sameBreakpointConfiguration(priorRequest, configuration)) {
                const existing = this.breakpointsByAddress.get(resolved.address);
                result.push({
                    id: existing?.id ?? this.nextBpId++,
                    verified: false,
                    message: `Breakpoint address ${hex4(resolved.address)} already has a different configuration.`,
                    line: bp.line,
                });
                continue;
            }
            requestedConfigurations.set(resolved.address, configuration);

            const existing = this.breakpointsByAddress.get(resolved.address);
            if (existing && !this.sameBreakpointConfiguration(existing, configuration)
                && (!previousAddresses.has(resolved.address)
                    || this.hasOtherSourceReference(resolved.address, sourceKey)
                    || this.instructionBpAddresses.has(resolved.address))) {
                result.push({
                    id: existing.id,
                    verified: false,
                    message: `Breakpoint address ${hex4(resolved.address)} already has a different configuration.`,
                    line: bp.line,
                });
                continue;
            }
            const breakpoint: AdapterBreakpoint = existing ?? {
                id: this.nextBpId++, address: resolved.address, ...configuration,
            };
            const backendChanged = !existing || !this.sameBackendConfiguration(existing, configuration);
            if (backendChanged) {
                Object.assign(breakpoint, configuration);
                const addResp = await this.client.send(
                    IpcCommand.DEBUG_BREAKPOINT_ADD,
                    this.makeBreakpointRequest(breakpoint),
                ).catch(() => ({ ok: false }));
                if (!addResp.ok) {
                    result.push({ id: breakpoint.id, verified: false, message: 'Backend rejected breakpoint', line: bp.line });
                    continue;
                }
                this.breakpointsByAddress.set(resolved.address, breakpoint);
                this.bpAddrToId.set(resolved.address, breakpoint.id);
                this.bpIdToAddr.set(breakpoint.id, resolved.address);
            } else if (existing) {
                existing.logMessage = configuration.logMessage;
            }
            result.push({
                id: breakpoint.id,
                verified: true,
                line: resolved.verifiedLine,
                instructionReference: hex4(resolved.address),
                message: this.breakpointMessage(breakpoint),
            });
        }
        this.sourceBpAddresses.set(sourceKey, desiredAddresses);
        for (const addr of previousAddresses) {
            if (!desiredAddresses.has(addr) && !this.isBreakpointAddressReferenced(addr)) {
                await this.deleteBackendBreakpoint(addr);
            }
        }
        if (desiredAddresses.size === 0) {
            this.sourceBpAddresses.delete(sourceKey);
        }
        this.sendResponseBody(req, { breakpoints: result });
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
        const requestedBreakpoints = (args.breakpoints ?? []).map((requested: any) => ({
            requested,
            address: parseInt(String(requested.instructionReference ?? '0x0'), 16) & 0xFFFF,
        }));
        const desired = requestedBreakpoints.map((breakpoint: { address: number }) => breakpoint.address);

        // Remove instruction breakpoints that are no longer desired and are not source-owned.
        const previousAddresses = this.instructionBpAddresses;
        this.instructionBpAddresses = new Set(desired);
        for (const addr of previousAddresses) {
            if (!this.instructionBpAddresses.has(addr) && !this.isBreakpointAddressReferenced(addr)) {
                await this.deleteBackendBreakpoint(addr);
            }
        }

        // Add newly requested breakpoints
        const result: any[] = [];
        for (const { requested, address: addr } of requestedBreakpoints) {
            let configuration: Omit<AdapterBreakpoint, 'id' | 'address'>;
            try {
                configuration = this.parseBreakpointConfiguration(requested, false);
            } catch (error) {
                result.push({
                    id: this.nextBpId++,
                    verified: false,
                    message: String(error instanceof Error ? error.message : error),
                    instructionReference: hex4(addr),
                });
                this.instructionBpAddresses.delete(addr);
                continue;
            }
            const existing = this.breakpointsByAddress.get(addr);
            if (existing && !this.sameBreakpointConfiguration(existing, configuration)
                && (!previousAddresses.has(addr)
                    || [...this.sourceBpAddresses.values()].some(addresses => addresses.has(addr)))) {
                result.push({
                    id: existing.id,
                    verified: false,
                    message: `Breakpoint address ${hex4(addr)} already has a different configuration.`,
                    instructionReference: hex4(addr),
                });
                continue;
            }
            const breakpoint: AdapterBreakpoint = existing ?? {
                id: this.nextBpId++, address: addr, ...configuration,
            };
            if (!existing || !this.sameBackendConfiguration(existing, configuration)) {
                Object.assign(breakpoint, configuration);
                const addResp = await this.client.send(
                    IpcCommand.DEBUG_BREAKPOINT_ADD,
                    this.makeBreakpointRequest(breakpoint),
                ).catch(() => ({ ok: false }));

                if (addResp.ok) {
                    this.breakpointsByAddress.set(addr, breakpoint);
                    this.bpAddrToId.set(addr, breakpoint.id);
                    this.bpIdToAddr.set(breakpoint.id, addr);
                    result.push({
                        id: breakpoint.id,
                        verified: true,
                        instructionReference: hex4(addr),
                        message: this.breakpointMessage(breakpoint),
                    });
                } else {
                    this.instructionBpAddresses.delete(addr);
                    result.push({
                        id: breakpoint.id,
                        verified: false,
                        message: 'Failed to set breakpoint in emulator.',
                        instructionReference: hex4(addr),
                    });
                }
            } else {
                result.push({
                    id: breakpoint.id,
                    verified: true,
                    instructionReference: hex4(addr),
                    message: this.breakpointMessage(breakpoint),
                });
            }
        }

        this.sendResponseBody(req, { breakpoints: result });
    }

    private isBreakpointAddressReferenced(addr: number): boolean {
        if (this.instructionBpAddresses.has(addr)) { return true; }
        return [...this.sourceBpAddresses.values()].some(addresses => addresses.has(addr));
    }

    private async deleteBackendBreakpoint(addr: number): Promise<void> {
        await this.client?.send(IpcCommand.DEBUG_BREAKPOINT_DEL, { addr }).catch(() => {});
        const id = this.bpAddrToId.get(addr);
        this.bpAddrToId.delete(addr);
        if (id !== undefined) { this.bpIdToAddr.delete(id); }
        this.breakpointsByAddress.delete(addr);
    }

    private async onDataBreakpointInfo(req: any): Promise<void> {
        if (!this.dataBreakpointsSupported()) {
            this.sendResponseBody(req, { dataId: null, description: 'Data breakpoints are unavailable' });
            return;
        }
        const expression = String(req.arguments?.name ?? '').trim();
        try {
            const address = evaluateSymbolExpression(expression, name => {
                const symbol = this.debugIndex?.symbol(name);
                if (!symbol) { throw new Error(`Unknown symbol: ${name}`); }
                return symbol.address;
            });
            if (!Number.isSafeInteger(address) || address < 0 || address > 0x20FFFF) {
                throw new Error('Address is outside global memory');
            }
            this.sendResponseBody(req, {
                dataId: `v6:${address}`,
                description: `Memory at 0x${address.toString(16).toUpperCase().padStart(5, '0')}`,
                accessTypes: ['read', 'write', 'readWrite'],
                canPersist: true,
            });
        } catch (error) {
            this.sendResponseBody(req, {
                dataId: null,
                description: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private async onSetDataBreakpoints(req: any): Promise<void> {
        if (!this.dataBreakpointsSupported() || !this.watchpointService) {
            this.sendResponse(req, false, 'The active emulator does not support data breakpoints');
            return;
        }
        try {
            for (const id of this.dapWatchpointIds) {
                await this.watchpointService.delete(id);
            }
            this.dapWatchpointIds.clear();
            this.watchpointIdToDapId.clear();

            const result: any[] = [];
            for (const requested of req.arguments?.breakpoints ?? []) {
                const match = /^v6:(\d+)$/.exec(String(requested.dataId ?? ''));
                if (!match) {
                    result.push({ verified: false, message: 'Invalid V6 data breakpoint identity' });
                    continue;
                }
                const address = Number(match[1]);
                const access = requested.accessType === 'read' ? 'R'
                    : requested.accessType === 'write' ? 'W' : 'RW';
                const entry = await this.watchpointService.add({
                    globalAddr: address,
                    len: 1,
                    value: 0,
                    access,
                    condition: 'ANY',
                    type: 'LEN',
                    active: true,
                    comment: `DAP data breakpoint at 0x${address.toString(16).toUpperCase()}`,
                });
                const dapId = this.nextBpId++;
                this.dapWatchpointIds.add(entry.id);
                this.watchpointIdToDapId.set(entry.id, dapId);
                result.push({ id: dapId, verified: true });
            }
            this.sendResponseBody(req, { breakpoints: result });
        } catch (error) {
            this.sendResponse(req, false, error instanceof Error ? error.message : String(error));
        }
    }

    private async onExceptionInfo(req: any): Promise<void> {
        const record = this.lastExceptionRecord;
        if (!record) {
            this.sendResponse(req, false, 'No exception stop information is available');
            return;
        }
        this.sendResponseBody(req, {
            exceptionId: String(record.exceptionCode ?? 'v6.exception'),
            description: record.description,
            breakMode: 'always',
            details: record.description ? { message: record.description } : undefined,
        });
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
                    result: typeof val === 'number'
                        ? BYTE_REGISTER_EXPRESSIONS.has(expr) ? hex2(val) : hex4(val)
                        : val,
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

    private async onRestart(req: any): Promise<void> {
        if (!this.client) {
            this.sendResponse(req, false, 'No active emulator session');
            return;
        }

        const resume = this.sessionState === 'running';
        this.stopPoll();
        this.pendingPause = false;
        this.pendingStep = false;
        this.pendingStepOverAddr = undefined;
        this.cachedRegs = null;

        try {
            const response = await this.client.send(IpcCommand.RESTART, undefined, 5000, 'critical');
            if (!response.ok) { throw new Error(response.error ?? 'Emulator restart failed'); }
            this.sessionState = 'paused';
            this.lifecycle.setExecutionRunning(false);
            if (resume) {
                await this.run();
            } else {
                await this.refreshRegs();
            }
            this.sendResponseBody(req, {});
        } catch (error) {
            this.sendResponse(req, false, error instanceof Error ? error.message : String(error));
        }
    }

    async reset(): Promise<void> {
        if (!this.client) { throw new Error('No active emulator session'); }

        const resume = this.sessionState === 'running';
        this.prepareForRestart();
        await this.sendControl(IpcCommand.STOP, 'Emulator stop failed');
        await this.sendControl(IpcCommand.RESET, 'Emulator reset failed');
        this.sessionState = 'paused';
        this.lifecycle.setExecutionRunning(false);
        if (resume) {
            await this.run();
        } else {
            await this.refreshRegs();
        }
    }

    async reloadRom(): Promise<void> {
        if (!this.client) { throw new Error('No active emulator session'); }
        if (!this.launchRequest?.program.toLowerCase().endsWith('.rom')) {
            throw new Error('Reload ROM is only available for ROM debug sessions');
        }

        this.prepareForRestart();
        await this.sendControl(IpcCommand.STOP, 'Emulator stop failed');
        await this.sendControl(IpcCommand.RESET, 'Emulator reset failed');
        await this.sendControl(IpcCommand.RESTART, 'Emulator restart failed');
        await this.lifecycle.reloadDebugRom(this.launchRequest);
        const debugResetRequest: DebugResetRequest = { resetRecorder: true };
        await this.sendControl(
            IpcCommand.DEBUG_RESET,
            'Debugger reset failed',
            debugResetRequest,
        );
        this.sessionState = 'paused';
        this.lifecycle.setExecutionRunning(false);
        await this.run();
    }

    private prepareForRestart(): void {
        this.stopPoll();
        this.pendingPause = false;
        this.pendingStep = false;
        this.pendingStepOverAddr = undefined;
        this.cachedRegs = null;
    }

    private async sendControl(command: IpcCommand, errorMessage: string, data?: unknown): Promise<void> {
        const response = await this.client!.send(command, data, 5000, 'critical');
        if (!response.ok) { throw new Error(response.error ?? errorMessage); }
    }

    // -----------------------------------------------------------------------
    // disconnect / terminate
    // -----------------------------------------------------------------------

    private async onDisconnect(req: any): Promise<void> {
        const terminateDebuggee = req.arguments?.terminateDebuggee ?? (this.emulatorProcess !== null);
        this.terminationRequested = true;
        await this.cleanup(terminateDebuggee);
        this.sendResponseBody(req, {});
        this.emitTerminated();
    }

    private async onTerminate(req: any): Promise<void> {
        this.terminationRequested = true;
        await this.cleanup(true);
        this.sendResponseBody(req, {});
        this.emitTerminated();
    }

    // -----------------------------------------------------------------------
    // Stop polling
    // -----------------------------------------------------------------------

    private startPoll(): void {
        this.stopPoll();
        this.pollingActive = true;
        const poll = async () => {
            if (!this.pollingActive || !this.client) { return; }
            try {
                const stopped = await this.isStopped();
                if (stopped) {
                    const record = this.stopRecordsSupported ? await this.readStopRecord() : undefined;
                    if (record && record.sequence === this.lastStopSequence) {
                        if (this.pendingPause) {
                            this.pollingActive = false;
                            this.pollTimer = null;
                            this.sessionState = 'paused';
                            this.lifecycle.setExecutionRunning(false);
                            await this.onStop();
                            return;
                        }
                        this.pollTimer = setTimeout(poll, POLL_INTERVAL_MS);
                        return;
                    }
                    this.pollingActive = false;
                    this.pollTimer = null;
                    this.sessionState = 'paused';
                    this.lifecycle.setExecutionRunning(false);
                    if (record) { this.lastStopSequence = record.sequence; }
                    await this.onStop(record);
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

    private async onStop(record?: StopRecord): Promise<void> {
        await this.refreshRegs();

        const stoppedAtStepOver = this.pendingStepOverAddr !== undefined
            && ((record?.reason === 'breakpoint' && record.breakpointAddress === this.pendingStepOverAddr)
                || (record === undefined && this.cachedRegs?.pc === this.pendingStepOverAddr));
        if (stoppedAtStepOver && this.pendingStepOverAddr !== undefined) {
            await this.client?.send(IpcCommand.DEBUG_BREAKPOINT_DEL, {
                addr: this.pendingStepOverAddr,
            }).catch(() => {});
            this.pendingStepOverAddr = undefined;
        }
        await this.syncServerBreakpoints();
        if (record) {
            if (record.reason === 'breakpoint' && record.breakpointAddress !== undefined) {
                const breakpoint = this.breakpointsByAddress.get(record.breakpointAddress);
                if (breakpoint?.logMessage) {
                    try {
                        this.sendEvent('output', { category: 'console', output: this.formatLogMessage(breakpoint.logMessage) });
                    } catch (error) {
                        this.sendEvent('output', { category: 'stderr', output: `V6: logpoint ${hex4(breakpoint.address)} failed: ${String(error)}\n` });
                    }
                    await this.resumeLogpoint();
                    return;
                }
            }
            this.pendingStep = false;
            this.pendingPause = false;
            const reason = mapStopReason(record.reason);
            const hitBreakpointIds = this.mapHitBreakpointIds(record);
            this.stopReason = reason;
            this.lastExceptionRecord = record.reason === 'exception' ? record : undefined;
            if (record.reason === 'watchpoint') {
                this.emitWatchpointOutput(record);
                this.watchpointsProvider?.showStop(
                    record.watchpointIds ?? [], record.accessedGlobalAddress,
                );
            }
            this.emitStopped(reason, hitBreakpointIds, record.description);
            return;
        }

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

    private async resumeLogpoint(): Promise<void> {
        await this.captureStopBaseline();
        this.cachedRegs = null;
        this.sessionState = 'running';
        this.lifecycle.setExecutionRunning(true);
        const response = await this.client?.send(IpcCommand.RUN, undefined, 5000, 'critical');
        if (!response?.ok) {
            this.sessionState = 'paused';
            this.lifecycle.setExecutionRunning(false);
            this.emitStopped('breakpoint', undefined, 'Logpoint automatic resume failed.');
            return;
        }
        this.startPoll();
    }

    private emitStopped(reason: StopReason, hitBreakpointIds?: number[], description?: string): void {
        this.sendEvent('stopped', {
            reason,
            description,
            threadId: THREAD_ID,
            allThreadsStopped: true,
            hitBreakpointIds,
        });
    }

    private async captureStopBaseline(): Promise<void> {
        this.lastExceptionRecord = undefined;
        if (!this.stopRecordsSupported) { return; }
        const record = await this.readStopRecord();
        this.lastStopSequence = record.sequence;
    }

    private async readStopRecord(): Promise<StopRecord> {
        const response = await this.client!.send<unknown>(
            IpcCommand.GET_STOP_RECORD, undefined, 5000, 'critical',
        );
        if (!response.ok || response.data === undefined) {
            throw new Error(response.error ?? 'Unable to read emulator stop record');
        }
        return decodeStopRecord(response.data);
    }

    private async isStopped(): Promise<boolean> {
        const response = await this.client!.send<IsRunningResponse>(
            IpcCommand.IS_RUNNING, undefined, 5000, 'critical',
        );
        return response.ok && response.data?.isRunning === false;
    }

    private mapHitBreakpointIds(record: StopRecord): number[] | undefined {
        if (record.reason === 'breakpoint') {
            const addresses = [record.breakpointAddress, ...(record.breakpointIds ?? [])]
                .filter((value): value is number => value !== undefined);
            const ids = addresses.map(address => this.bpAddrToId.get(address))
                .filter((value): value is number => value !== undefined);
            return ids.length ? [...new Set(ids)] : undefined;
        }
        return record.reason === 'watchpoint' && record.watchpointIds?.length
            ? record.watchpointIds.map(id => this.watchpointIdToDapId.get(id))
                .filter((id): id is number => id !== undefined)
            : undefined;
    }

    private dataBreakpointsSupported(): boolean {
        return this.stopRecordsSupported && this.watchpointService?.available === true;
    }

    private showUnavailableSourceIndicator(sourcePath: string, line: number): void {
        if (!this.unavailableSourceDecoration) {
            this.unavailableSourceDecoration = vscode.window.createTextEditorDecorationType({
                isWholeLine: true,
                backgroundColor: '#d96e045b',
                after: {
                    contentText: ' Source is unavailable.',
                    color: '#f6ece6',
                    fontStyle: 'italic',
                    margin: '0 0 0 1em',
                },
            });
        }
        const normalizedPath = path.normalize(sourcePath);
        for (const editor of vscode.window.visibleTextEditors) {
            const sameSource = process.platform === 'win32'
                ? path.normalize(editor.document.uri.fsPath).toLowerCase() === normalizedPath.toLowerCase()
                : path.normalize(editor.document.uri.fsPath) === normalizedPath;
            editor.setDecorations(this.unavailableSourceDecoration, sameSource
                ? [new vscode.Range(line - 1, 0, line - 1, 0)]
                : []);
        }
    }

    private clearUnavailableSourceIndicator(): void {
        if (!this.unavailableSourceDecoration) { return; }
        for (const editor of vscode.window.visibleTextEditors) {
            editor.setDecorations(this.unavailableSourceDecoration, []);
        }
    }

    private publishDynamicCapabilities(): void {
        if (!this.stopRecordsSupported) { return; }
        this.sendEvent('capabilities', {
            capabilities: {
                supportsDataBreakpoints: this.dataBreakpointsSupported(),
                supportsExceptionInfoRequest: true,
                supportsLogPoints: this.stopRecordsSupported,
            },
        });
    }

    private emitWatchpointOutput(record: StopRecord): void {
        const ids = record.watchpointIds?.join(', ') ?? 'unknown';
        const access = record.access ?? 'access';
        const address = record.accessedGlobalAddress === undefined
            ? 'unknown address'
            : `0x${record.accessedGlobalAddress.toString(16).toUpperCase().padStart(5, '0')}`;
        const values = record.oldValue !== undefined && record.newValue !== undefined
            ? `, ${hex2(record.oldValue)} -> ${hex2(record.newValue)}`
            : record.observedValue !== undefined ? `, value ${hex2(record.observedValue)}` : '';
        this.sendEvent('output', {
            category: 'console',
            output: `V6: Watchpoint ${ids}: ${access} at ${address}${values}, stopped at PC ${hex4(record.pc)}\n`,
        });
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private async syncServerBreakpoints(): Promise<void> {
        if (!this.client) { return; }
        try {
            const response = await this.client.send<BreakpointEntry[]>(IpcCommand.DEBUG_BREAKPOINT_GET_ALL);
            if (!response.ok || !Array.isArray(response.data)) { return; }

            const serverAddresses = new Set(response.data.map(breakpoint => breakpoint.addr));
            for (const breakpoint of response.data) {
                if (this.bpAddrToId.has(breakpoint.addr) || this.serverBreakpointIds.has(breakpoint.addr)) {
                    continue;
                }
                const id = this.nextBpId++;
                this.serverBreakpointIds.set(breakpoint.addr, id);
                const sourceLocation = this.debugIndex?.resolveAddress(breakpoint.addr);
                const sourcePath = sourceLocation
                    ? resolveDebugSourcePath(sourceLocation.file, this.workspaceRoot)
                    : undefined;
                this.sendEvent('breakpoint', {
                    reason: 'new',
                    breakpoint: {
                        id,
                        verified: breakpoint.status === 'ACTIVE',
                        instructionReference: hex4(breakpoint.addr),
                        message: breakpoint.comment || undefined,
                        source: sourcePath
                            ? { name: path.basename(sourcePath), path: sourcePath, sourceReference: 0 }
                            : undefined,
                        line: sourceLocation?.line,
                        column: sourceLocation?.column,
                    },
                });
            }

            for (const [addr, id] of this.serverBreakpointIds) {
                if (serverAddresses.has(addr)) { continue; }
                this.serverBreakpointIds.delete(addr);
                this.sendEvent('breakpoint', { reason: 'removed', breakpoint: { id } });
            }
        } catch (error) {
            this.logger.debug(`v6-debug: breakpoint synchronization unavailable: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async refreshRegs(): Promise<void> {
        if (!this.client) { return; }
        try {
            const resp = await this.client.send<GetRegsResponse>(IpcCommand.GET_REGS);
            if (resp.ok && resp.data) {
                this.cachedRegs = resp.data;
            }
        } catch (err) {
            this.logger.debug(`v6-debug: registers unavailable: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private async safeGetRegs(): Promise<GetRegsResponse | null> {
        if (this.cachedRegs) { return this.cachedRegs; }
        await this.refreshRegs();
        return this.cachedRegs;
    }

    private async cleanup(terminateDebuggee: boolean): Promise<void> {
        this.stopPoll();
        this.sessionState = 'disconnected';
        this.clearUnavailableSourceIndicator();
        this.unavailableSourceDecoration?.dispose();
        this.unavailableSourceDecoration = undefined;
        this.lastResolvedSource = undefined;

        // Remove all DAP-owned breakpoints
        if (this.client?.connected) {
            if (this.watchpointService?.available) {
                for (const id of this.dapWatchpointIds) {
                    await this.watchpointService.delete(id).catch(() => {});
                }
            }
            for (const addr of this.bpAddrToId.keys()) {
                await this.client.send(IpcCommand.DEBUG_BREAKPOINT_DEL, { addr }).catch(() => {});
            }
            await this.client.send(IpcCommand.DEBUG_ATTACH, { data: false }).catch(() => {});
            if (terminateDebuggee && this.lifecycle.owner !== 'debug') {
                await this.client.send(IpcCommand.EXIT, {}).catch(() => {});
            }
            if (this.lifecycle.owner === 'debug') {
                if (terminateDebuggee) {
                    await this.lifecycle.stop();
                } else {
                    this.lifecycle.disconnect();
                }
            } else {
                this.client.disconnect();
            }
        }

        this.bpAddrToId.clear();
        this.bpIdToAddr.clear();
        this.breakpointsByAddress.clear();
        this.sourceBpAddresses.clear();
        this.instructionBpAddresses.clear();
        this.watchpointIdToDapId.clear();
        this.dapWatchpointIds.clear();
        this.client = null;
        this.emulatorProcess = null;
        this.cachedRegs = null;
        this.stopRecordsSupported = false;
        this.lastStopSequence = undefined;
        this.lastExceptionRecord = undefined;
    }

    private emitTerminated(exitCode?: number): void {
        if (this.terminationEmitted) { return; }
        this.terminationEmitted = true;
        this.stopPoll();
        this.sessionState = 'disconnected';
        if (exitCode !== undefined) {
            this.sendEvent('exited', { exitCode });
        }
        this.sendEvent('terminated');
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

function mapStopReason(reason: StopRecord['reason']): StopReason {
    switch (reason) {
        case 'breakpoint': return 'breakpoint';
        case 'watchpoint': return 'data breakpoint';
        case 'step':
        case 'next':
        case 'frameStep': return 'step';
        case 'exception': return 'exception';
        case 'unknown': return 'unknown';
        default: return 'pause';
    }
}
