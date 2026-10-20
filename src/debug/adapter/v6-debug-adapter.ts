import { DapRequest, DapResponse, DapEvent, dapRequest } from './dap-protocol';
import { ExecutionController } from '../session/execution-controller';
import * as path from 'path';
import * as vscode from 'vscode';
import type { SessionLease } from '../../emulator/session/session-coordinator';
import type { CommandSender } from '../../emulator/session/session-operations';
import { EmulatorProcess } from '../../emulator/launcher/v6emul-launcher';
import { DebugLaunchRequest, SessionCoordinator } from '../../emulator/session/session-coordinator';
import type { DebugDisplay, WatchpointFeedback } from './debug-ui-ports';
import {
    IpcCommand,
    GetRegsResponse,
} from '../../emulator/protocol/ipc-commands';
import {
    GetStepOverAddrResponse,
    GetStackSampleResponse,
    StopRecord,
    StopReason,
} from '../../emulator/protocol/debug-models';
import { artifactRepository } from '../metadata/artifact-repository';
import { DebugIndex, SourceLocation } from '../metadata/debug-index';
import { DebugMetadataIndex } from '../metadata/debug-metadata-index';
import { DebugStopContext } from '../metadata/debug-stop-context';
import { resolveDebugSourcePath } from '../metadata/debug-source-path';
import { Logger } from '../../platform/logging/logger';
import { PathService } from '../../platform/files/path-service';
import { supportsStopRecords } from '../../emulator/protocol/ipc-server-info';
import { WatchpointService } from '../watchpoints/watchpoint-service';
import { evaluateSymbolExpression } from '../utilities/symbol-expression';
import { DapHandleStore } from './dap-handle-store';
import { ScopeService, SemanticScope, SemanticScopeKind } from './scope-service';
import { DapFrameContext, StackTraceService } from './stack-trace-service';
import { VariableService } from './variable-service';
import { hexAddress, TypedValue } from '../values/value-format';
import { dapVariableValue } from './dap-value-presenter';
import { ValueEvaluationService, ValueEvaluationContext } from '../values/value-evaluation-service';
import { isAssemblerSource, isHoverEvaluation } from '../values/evaluation-context';
import { toDwarfRegisters } from '../metadata/v6c-register-map';
import { BreakpointCoordinator } from '../session/breakpoint-coordinator';
import { memoryCapabilities } from '../../emulator/memory/memory-backend';
import { LogicalLocationIndex } from './logical-location-index';
import { SourceStepService, SourceStepState } from './source-step-service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const THREAD_ID = 1;
const THREAD_NAME = 'V6 CPU';
const HOVER_EVALUATION_TIMEOUT_MS = 100;
const SOURCE_STEP_LIMITS = { maxInstructions: 10000, maxElapsedMs: 5000, maxCandidates: 64 };

type MachineScopeKind = 'registers' | 'flags' | 'stack';

interface MachineScopeHandle {
    frameId: number;
    kind: MachineScopeKind;
}

interface SemanticScopeHandle {
    frameId: number;
    scope: SemanticScope;
    kind: SemanticScopeKind;
}

interface VariableHandle {
    context: DebugStopContext;
    value: TypedValue;
    depth: number;
}

type ScopeHandle = MachineScopeHandle | SemanticScopeHandle;
type VariablesHandle = ScopeHandle | VariableHandle;

interface InlineFrameSource {
    file: string;
    line: number;
    column: number;
}

interface InlineFrameName {
    id: number;
    name: string;
    source: InlineFrameSource | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hex4 = hexAddress;
function hex2(n: number): string { return hexAddress(n, 1); }

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
 *   - source/instruction breakpoints delegated to the breakpoint coordinator
 *   - typed expressions, verified stack frames and source/instruction stepping
 *   - authoritative stop-record polling with IS_RUNNING fallback
 */
export class V6DebugAdapter implements vscode.DebugAdapter {
    private readonly _onDidSendMessage = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
    readonly onDidSendMessage = this._onDidSendMessage.event;

    // IPC
    private client: (CommandSender & { readonly connected: boolean }) | null = null;
    private sessionLease: SessionLease | undefined;
    private emulatorProcess: EmulatorProcess | null = null;

    // Debug metadata
    private debugIndex: DebugIndex | null = null;
    private debugMetadata: DebugMetadataIndex | undefined;
    private debugMetadataError = 'No debug artifact was configured in the active project.';
    private workspaceRoot = '';
    private lastResolvedSource: SourceLocation | undefined;
    private unavailableSourceDecoration: vscode.TextEditorDecorationType | undefined;

    // Session state
    private initialized = false;
    private stopReason: StopReason = 'entry';
    private pendingStepOverAddr: number | undefined;
    private sourceStep = this.createSourceStepService(SOURCE_STEP_LIMITS);
    private createSourceStepService(limits: typeof SOURCE_STEP_LIMITS): SourceStepService {
        return new SourceStepService(limits, Date.now, async () => {
            await this.releaseSourceStepBreakpoints();
        });
    }
    private sourceStepAddresses: number[] = [];
    private sourceStepFilters: readonly string[] = [];
    private readonly breakpoints = new BreakpointCoordinator(() => this.client,
        () => ({ index: this.debugIndex, metadataError: this.debugMetadataError, registers: this.cachedRegs }),
        message => this.logger.warn(message));
    private terminationEmitted = false;
    private terminationRequested = false;
    private launchRequest: DebugLaunchRequest | null = null;
    private stopOnEntry = false;
    private stopRecordsSupported = false;
    private lastExceptionRecord: StopRecord | undefined;

    // Breakpoint tracking: DAP breakpoint ID → CPU address
    private watchpointIdToDapId = new Map<number, number>();
    private dapWatchpointIds = new Set<number>();

    // Frame-level cache — refreshed on each pause
    private cachedRegs: GetRegsResponse | null = null;
    private stoppedGeneration = 0;
    private stopContext: DebugStopContext | undefined;
    private readonly stackTraceService = new StackTraceService();
    private readonly scopeService = new ScopeService();
    private readonly variableService = new VariableService();
    private readonly valueEvaluationService = new ValueEvaluationService();
    // Every DAP variablesReference belongs to one namespace, regardless of
    // whether it represents a scope, a Watch result, or an aggregate child.
    private readonly variablesHandles = new DapHandleStore<VariablesHandle>();

    private readonly execution = new ExecutionController(() => {
        const client = this.client;
        const lease = this.sessionLease;
        if (!client) { throw new Error('No active emulator session'); }
        return { client, records: this.stopRecordsSupported, assertCurrent: () => {
            if (client !== this.client || lease !== this.sessionLease) { throw new Error('Control belongs to an inactive session'); }
            lease?.assertCurrent();
        } };
    }, {
        prepare: async () => {
            await this.cancelSourceStep(); await this.releaseSourceStepBreakpoints();
            if (this.pendingStepOverAddr !== undefined) { await this.breakpoints.releaseTemporary(this.pendingStepOverAddr); this.pendingStepOverAddr = undefined; }
        },
        synchronize: () => this.syncServerBreakpoints(),
        invalidate: () => { this.watchpointsProvider?.showStop([]); this.clearUnavailableSourceIndicator(); this.cachedRegs = null; this.invalidateStopContext(); },
        running: value => this.lifecycle.setExecutionRunning(value, this.sessionLease),
        continued: () => this.sendEvent('continued', { threadId: THREAD_ID, allThreadsContinued: true }),
        stopped: record => this.onStop(record),
        refresh: () => this.refreshRegs(),
        clearException: () => { this.lastExceptionRecord = undefined; },
    });

    constructor(
        private readonly lifecycle: SessionCoordinator,
        private readonly emulatorPanel: DebugDisplay,
        private readonly logger: Logger,
        private readonly pathService: PathService,
        private readonly getConfiguration: (s: string) => vscode.WorkspaceConfiguration,
        private readonly watchpointService?: WatchpointService,
        private readonly watchpointsProvider?: WatchpointFeedback,
    ) {}

    // -----------------------------------------------------------------------
    // vscode.DebugAdapter interface
    // -----------------------------------------------------------------------

    handleMessage(message: vscode.DebugProtocolMessage): void {
        const msg = dapRequest(message);
        if (msg) {
            this.dispatchRequest(msg).catch(err => {
                this.logger.error(`v6-debug: unhandled error in ${msg.command}: ${err}`);
                this.sendResponse(msg, false, err instanceof Error ? err.message : String(err));
            });
        }
    }

    dispose(): void {
        void this.cleanup(false).catch(error => this.logger.error(`v6-debug dispose: ${error}`));
        this._onDidSendMessage.dispose();
    }

    // -----------------------------------------------------------------------
    // Request dispatch
    // -----------------------------------------------------------------------

    private async dispatchRequest(req: DapRequest): Promise<void> {
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
            case 'stepOut':              await this.onStepOut(req); break;
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

    private async onInitialize(req: DapRequest): Promise<void> {
        this.initialized = true;
        this.sendResponseBody(req, {
            supportsConfigurationDoneRequest: true,
            supportsStepInTargetsRequest: false,
            supportsSteppingGranularity: true,
            supportsStepOut: true,
            supportsSetVariable: false,
            supportsEvaluateForHovers: true,
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

    private async onLaunch(req: DapRequest): Promise<void> {
        const args = req.arguments ?? {};
        try {
            this.debugIndex = null;
            this.debugMetadata = undefined;
            this.invalidateStopContext();
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
                fddReadOnly: args.fddReadOnly === true,
            };
            this.stopOnEntry = Boolean(args.stopOnEntry);
            const launch = await this.lifecycle.startDebug(this.launchRequest);
            const { process, port } = launch;
            const lease = this.lifecycle.captureSession();
            this.sessionLease = lease;
            this.client = lease;
            this.emulatorProcess = process;
            this.stopRecordsSupported = this.lifecycle.serverInfo !== undefined
                && supportsStopRecords(this.lifecycle.serverInfo);
            this.publishDynamicCapabilities();
            process.spawnResult.exitPromise.then(code => {
                this.logger.info(`v6emul exited with code ${code}`);
                if (this.sessionLease === lease && !this.terminationRequested) {
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
                    const loadResult = await artifactRepository.load(elfPath, romPath);
                    lease.assertCurrent();
                    this.debugIndex = loadResult.index;
                    this.debugMetadata = loadResult.metadata;
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
            lease.assertCurrent();
            this.execution.state = 'paused';
            try {
                this.emulatorPanel.reveal();
            } catch (panelError: any) {
                this.logger.error(`v6-debug: emulator display panel failed to open: ${panelError?.stack ?? panelError}`);
                throw panelError;
            }
            this.logger.info('v6-debug: emulator display panel opened');
            this.sendEvent('output', { category: 'console', output: `V6: Emulator ready on port ${port}; display panel connected to debug session.\n` });

            this.sendResponseBody(req, {});
            // Signal VS Code that breakpoints can now be sent.
            // Must come AFTER the ELF is loaded so debugIndex is ready for setBreakpoints.
            this.sendEvent('initialized');
        } catch (err: any) {
            this.logger.error(`v6-debug: launch failed: ${err?.stack ?? err}`);
            this.sendResponse(req, false, `Launch failed: ${err.message}`);
            await this.cleanup(true).catch(error => this.logger.error(`v6-debug cleanup: ${error}`));
        }
    }

    // -----------------------------------------------------------------------
    // attach
    // -----------------------------------------------------------------------

    private async onAttach(req: DapRequest): Promise<void> {
        const args = req.arguments ?? {};
        try {
            const port = Number(args.port ?? 9876);
            const host = String(args.host ?? '127.0.0.1');
            const lease = await this.lifecycle.attach(port, host);
            this.sessionLease = lease;
            this.client = lease;
            this.stopRecordsSupported = this.lifecycle.serverInfo !== undefined && supportsStopRecords(this.lifecycle.serverInfo);
            this.publishDynamicCapabilities();
            this.execution.state = 'paused';

            this.sendResponseBody(req, {});
            this.sendEvent('initialized');
        } catch (err: any) {
            this.sendResponse(req, false, `Attach failed: ${err.message}`);
        }
    }

    // -----------------------------------------------------------------------
    // configurationDone — breakpoints have been sent; start or remain paused
    // -----------------------------------------------------------------------

    private async onConfigurationDone(req: DapRequest): Promise<void> {
        try {
            if (this.launchRequest) {
                await this.lifecycle.loadDebugProgram(this.launchRequest, this.sessionLease);
            }
            this.sendResponseBody(req, {});

            if (this.stopOnEntry) {
                this.stopReason = 'entry';
                await this.refreshRegs();
                this.captureStopContext();
                this.emitStopped('entry');
            } else {
                await this.run();
            }
        } catch (err: any) {
            this.sendResponse(req, false, `Could not load debug program: ${err.message}`);
            await this.cleanup(true).catch(error => this.logger.error(`v6-debug cleanup: ${error}`));
        }
    }

    // -----------------------------------------------------------------------
    // threads
    // -----------------------------------------------------------------------

    private async onThreads(req: DapRequest): Promise<void> {
        this.sendResponseBody(req, {
            threads: [{ id: THREAD_ID, name: THREAD_NAME }],
        });
    }

    // -----------------------------------------------------------------------
    // stackTrace
    // -----------------------------------------------------------------------

    private async onStackTrace(req: DapRequest): Promise<void> {
        if (this.stopContext) {
            await this.stackTraceService.capture(
                this.stoppedGeneration,
                this.stopContext,
                pc => this.debugMetadata?.physicalSubprogramAt(pc)?.name ?? this.debugIndex?.symbolAtAddress(pc)?.name,
                pc => this.resolveInlineFrameNames(pc),
                frame => this.resolveFrameDisplayPc(frame),
            );
            const page = this.stackTraceService.page(req.arguments?.startFrame, req.arguments?.levels);
            this.sendResponseBody(req, {
                stackFrames: page.frames.map((frame, index) => this.makeStackFrame(
                    frame.id, frame.name, frame.instructionPc, frame.displayPc, frame.source, index === 0,
                )),
                totalFrames: page.totalFrames,
            });
            return;
        }

        const regs = await this.safeGetRegs();
        const pc = regs?.pc ?? 0;

        this.sendResponseBody(req, {
            stackFrames: [this.makeStackFrame(1, this.debugIndex?.symbolAtAddress(pc)?.name ?? hex4(pc), pc, pc, undefined, true)],
            totalFrames: 1,
        });
    }

    /**
     * Inline Call Stack frames at a PC. Frame sources align with the expansion
     * nesting: the innermost frame shows the deepest macro body row, and each
     * outer frame shows the row of its own body statement that invoked the
     * inner expansion. Those rows stack at the same address in line-program
     * order (invocation rows first, deepest body row last), so the chain —
     * ordered innermost first — walks the row list from its end. The
     * address-level `resolveAddress` row, the outermost invocation, remains
     * the caller frame's source.
     */
    private resolveInlineFrameNames(pc: number): InlineFrameName[] {
        if (!this.debugMetadata) { return []; }
        const rows = this.debugIndex?.resolveAddressRows(pc) ?? [];
        return this.debugMetadata.inlineChainAt(pc)
            .map((scope, index) => {
                const name = scope.abstractOrigin === undefined
                    ? undefined
                    : this.debugMetadata?.subprogram(scope.abstractOrigin)?.name;
                if (!name) { return undefined; }
                const rowIndex = rows.length - 1 - index;
                const source = (rowIndex >= 0 ? rows[rowIndex] : undefined)
                    ?? this.debugIndex?.resolveAddress(pc);
                return {
                    id: scope.id,
                    name,
                    source: source
                        ? { file: source.file, line: source.line, column: source.column }
                        : undefined,
                };
            })
            .filter((frame): frame is InlineFrameName => frame !== undefined);
    }

    private resolveFrameDisplayPc(frame: import('../metadata/debug-stop-context').PhysicalFrame): number {
        if (frame.index === 0 || !this.debugMetadata || !this.debugIndex) { return frame.pc; }
        const subprogram = this.debugMetadata.subprogramAt(frame.pc);
        return subprogram
            ? this.debugIndex.resolvePrecedingStatement(frame.pc, subprogram.ranges)
                ?? frame.pc
            : frame.pc;
    }

    private makeStackFrame(
        id: number,
        name: string,
        pc: number,
        displayPc = pc,
        sourceOverride?: { file: string; line: number; column: number },
        isTopFrame = false,
    ): any {
        // Resolve PC to source location using debug index
        const srcLoc = sourceOverride
            ? { ...sourceOverride, isStmt: false }
            : this.debugIndex?.resolveAddress(displayPc);
        const frame: any = {
            id,
            name,
            instructionPointerReference: hex4(pc),
            line: 1,
            column: 1,
        };

        if (srcLoc) {
            const sourcePath = resolveDebugSourcePath(srcLoc.file, this.workspaceRoot);
            if (isTopFrame) {
                this.lastResolvedSource = srcLoc;
                this.clearUnavailableSourceIndicator();
            }
            frame.source = {
                path: sourcePath,
                name: path.basename(sourcePath),
                sourceReference: 0,
            };
            frame.line = srcLoc.line;
            frame.column = srcLoc.column;
        } else if (isTopFrame && this.debugIndex && this.lastResolvedSource) {
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
        return frame;
    }

    // -----------------------------------------------------------------------
    // scopes
    // -----------------------------------------------------------------------

    private async onScopes(req: DapRequest): Promise<void> {
        const frameId = req.arguments?.frameId ?? 0;
        const frame = this.stopContext
            ? this.stackTraceService.frame(this.stoppedGeneration, frameId)
            : undefined;
        if (this.stopContext && !frame) {
            this.sendResponseBody(req, { scopes: [] });
            return;
        }
        if (this.debugMetadata && frame) {
            const semanticScopes = this.scopeService.scopes(this.debugMetadata, frame);
            this.sendResponseBody(req, {
                scopes: [
                    ...semanticScopes.map(scope => ({
                        name: scope.name,
                        variablesReference: this.variablesHandles.create(this.stoppedGeneration, {
                            frameId,
                            kind: scope.kind,
                            scope,
                        }),
                        expensive: scope.expensive,
                    })),
                    ...this.machineScopes(frameId),
                ],
            });
            return;
        }
        this.sendResponseBody(req, {
            scopes: this.machineScopes(frameId),
        });
    }

    private machineScopes(frameId: number): any[] {
        return [
            { name: 'Registers', variablesReference: this.variablesHandles.create(this.stoppedGeneration, { frameId, kind: 'registers' }), expensive: false, presentationHint: 'registers' },
            { name: 'Flags', variablesReference: this.variablesHandles.create(this.stoppedGeneration, { frameId, kind: 'flags' }), expensive: false },
            { name: 'Raw Stack', variablesReference: this.variablesHandles.create(this.stoppedGeneration, { frameId, kind: 'stack' }), expensive: false },
        ];
    }

    // -----------------------------------------------------------------------
    // variables
    // -----------------------------------------------------------------------

    private async onVariables(req: DapRequest): Promise<void> {
        const ref = req.arguments?.variablesReference ?? 0;
        const handle = this.variablesHandles.get(this.stoppedGeneration, ref);
        if (!handle) {
            this.sendResponseBody(req, { variables: [] });
            return;
        }
        if ('value' in handle) {
            const variable = handle;
            if (variable.depth >= 8) {
                this.sendResponseBody(req, { variables: [] });
                return;
            }
            const children = await this.variableService.children(variable.context, variable.value, req.arguments?.start, req.arguments?.count);
            this.sendResponseBody(req, { variables: children.map(child => this.withVariableHandle(child, variable.context, variable.depth + 1)) });
            return;
        }
        const scope = handle;
        if ('scope' in scope) {
            const frame = this.stopContext && this.stackTraceService.frame(this.stoppedGeneration, scope.frameId);
            if (!this.debugMetadata || !this.stopContext || !frame) {
                this.sendResponseBody(req, { variables: [] });
                return;
            }
            const variables = await this.variableService.dapVariables(
                this.debugMetadata,
                this.stopContext,
                frame.physicalFrame,
                scope.scope.variables,
                req.arguments?.start,
                req.arguments?.count,
            );
            this.sendResponseBody(req, { variables: variables.map(variable => this.withVariableHandle(variable, this.stopContext!, 0)) });
            return;
        }
        if (!['registers', 'flags', 'stack'].includes(scope.kind)) {
            this.sendResponseBody(req, { variables: [] });
            return;
        }
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

        if (scope.kind === 'registers') {
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
        } else if (scope.kind === 'flags') {
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
        } else if (scope.kind === 'stack') {
            const stackVars = await this.buildStackVars(regs.sp);
            this.sendResponseBody(req, { variables: stackVars });
        } else {
            this.sendResponseBody(req, { variables: [] });
        }
    }

    private withVariableHandle(variable: import('./dap-value-presenter').DapVariableValue, context: DebugStopContext, depth: number): any {
        const { valueData, ...dapVariable } = variable;
        const count = (dapVariable.namedVariables ?? 0) + (dapVariable.indexedVariables ?? 0);
        return {
            ...dapVariable,
            variablesReference: count === 0 ? 0 : this.variablesHandles.create(this.stoppedGeneration, { context, value: valueData, depth }),
        };
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

    private async onContinue(req: DapRequest): Promise<void> {
        await this.cancelSourceStep();
        await this.run();
        this.sendResponseBody(req, { allThreadsContinued: true });
    }

    private async run(): Promise<void> { if (this.client) { await this.execution.run(); } }

    // -----------------------------------------------------------------------
    // pause
    // -----------------------------------------------------------------------

    private async onPause(req: DapRequest): Promise<void> {
        await this.cancelSourceStep();
        await this.execution.pause();
        this.sendResponseBody(req, {});
    }

    // -----------------------------------------------------------------------
    // next (step over)
    // -----------------------------------------------------------------------

    private async onNext(req: DapRequest): Promise<void> {
        if (!this.client) { this.sendResponseBody(req, {}); return; }
        if (await this.startSourceStep('over', req)) { return; }

        this.execution.pendingStep = true;
        this.cachedRegs = null;
        this.invalidateStopContext();

        try {
            // Ask backend for step-over address (address after current instruction / CALL target)
            const soResp = await this.client.send<GetStepOverAddrResponse>(IpcCommand.GET_STEP_OVER_ADDR);
            const soAddr = soResp.ok && typeof soResp.data?.data === 'number' ? soResp.data.data : 0;

            if (soAddr > 0 && soAddr !== 0xFFFF) {
                // Set a temporary auto-delete breakpoint at the step-over address
                if (!await this.breakpoints.acquireTemporary(soAddr)) {
                    this.execution.pendingStep = false;
                    this.sendResponse(req, false, this.breakpoints.temporaryError ?? 'Unable to set the temporary step-over breakpoint');
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
            this.execution.pendingStep = false;
            this.sendResponse(req, false, error instanceof Error ? error.message : String(error));
        }
    }

    // -----------------------------------------------------------------------
    // stepIn
    // -----------------------------------------------------------------------

    private async onStepIn(req: DapRequest): Promise<void> {
        if (await this.startSourceStep('into', req)) { return; }
        this.sendResponseBody(req, {});
        this.execution.pendingStep = true;
        this.cachedRegs = null;
        this.invalidateStopContext();
        await this.singleStep();
    }

    private async onStepOut(req: DapRequest): Promise<void> {
        // DAP StepOutArguments has no frameId. VS Code steps out from the stopped
        // top frame; retain the optional ID for custom clients and focused tests.
        const frame = this.stackTraceService.frame(this.stoppedGeneration, req.arguments?.frameId ?? -1)
            ?? this.stackTraceService.page(0, 1).frames[0];
        if (frame?.inlineDieIdentity !== undefined && await this.startInlineStepOut(frame, req)) {
            return;
        }
        if (!frame?.physicalFrame.returnPc) {
            this.sendResponse(req, false, 'Selected frame has no verified caller');
            return;
        }
        await this.cancelSourceStep();
        if (!await this.breakpoints.acquireTemporary(frame.physicalFrame.returnPc)) {
            this.sendResponse(req, false, this.breakpoints.temporaryError ?? 'Unable to set the temporary step-out breakpoint');
            return;
        }
        this.sourceStepAddresses = [frame.physicalFrame.returnPc];
        this.execution.pendingStep = true;
        this.sendResponseBody(req, {});
        await this.run();
    }

    private async startInlineStepOut(frame: DapFrameContext, req: DapRequest): Promise<boolean> {
        if (!this.debugIndex || !this.debugMetadata || !this.cachedRegs || frame.physicalFrame.index !== 0) {
            return false;
        }
        const subprogram = this.debugMetadata.subprogramAt(frame.instructionPc);
        const locations = new LogicalLocationIndex(this.debugIndex, this.debugMetadata);
        const statement = subprogram && locations.at(frame.instructionPc, 'top');
        if (!statement) { return false; }
        const candidates = locations.next(statement, subprogram.ranges)
            .filter(candidate => !candidate.location.inlineChain.includes(frame.inlineDieIdentity!))
            .flatMap(candidate => candidate.ranges.map(range => range.start));
        this.sourceStepFilters = [];
        const configuration = vscode.workspace.getConfiguration('v6.debug');
        this.sourceStep = this.createSourceStepService({
            maxInstructions: configuration.get<number>('sourceStepMaxInstructions', SOURCE_STEP_LIMITS.maxInstructions),
            maxElapsedMs: configuration.get<number>('sourceStepMaxElapsedMs', SOURCE_STEP_LIMITS.maxElapsedMs),
            maxCandidates: configuration.get<number>('sourceStepMaxCandidates', SOURCE_STEP_LIMITS.maxCandidates),
        });
        const start: SourceStepState = {
            location: statement.location,
            physicalDepth: frame.physicalFrame.index,
            inlineDepth: this.debugMetadata.inlineChainAt(frame.instructionPc).length,
        };
        if (this.sourceStep.begin('out', start, candidates.length) !== 'continue') {
            this.sendResponse(req, false, 'Source step exceeded the instruction budget');
            return true;
        }
        this.sourceStepAddresses = [];
        for (const address of candidates) {
            if (!await this.breakpoints.acquireTemporary(address)) {
                await this.cancelSourceStep();
                this.sendResponse(req, false, this.breakpoints.temporaryError ?? 'Unable to set an inline step-out breakpoint');
                return true;
            }
            this.sourceStepAddresses.push(address);
        }
        this.execution.pendingStep = true;
        this.sendResponseBody(req, {});
        if (candidates.length === 0) {
            await this.singleStep();
        } else {
            await this.run();
        }
        return true;
    }

    private async startSourceStep(kind: 'into' | 'over', req: DapRequest): Promise<boolean> {
        if (req.arguments?.granularity === 'instruction' || !this.debugIndex || !this.debugMetadata || !this.cachedRegs) {
            return false;
        }
        const pc = this.cachedRegs.pc;
        const subprogram = this.debugMetadata.subprogramAt(pc);
        if (!subprogram) { return false; }
        const locations = new LogicalLocationIndex(this.debugIndex, this.debugMetadata);
        const statement = locations.at(pc, 'top');
        if (!statement) { return false; }
        const inlineDepth = this.debugMetadata.inlineChainAt(pc).length;
        const start: SourceStepState = { location: statement.location, physicalDepth: 0, inlineDepth };
        const configuration = vscode.workspace.getConfiguration('v6.debug');
        const filters = configuration.get<string[]>('sourceStepFilters', []);
        this.sourceStepFilters = filters;
        const nextStatement = kind === 'into' ? undefined : locations.next(statement, subprogram.ranges)
            .find(candidate => !filters.some(filter => matchesSourceFilter(candidate.location.file, filter)));
        const candidates = nextStatement?.ranges.map(range => range.start) ?? [];
        this.sourceStep = this.createSourceStepService({
            maxInstructions: configuration.get<number>('sourceStepMaxInstructions', SOURCE_STEP_LIMITS.maxInstructions),
            maxElapsedMs: configuration.get<number>('sourceStepMaxElapsedMs', SOURCE_STEP_LIMITS.maxElapsedMs),
            maxCandidates: configuration.get<number>('sourceStepMaxCandidates', SOURCE_STEP_LIMITS.maxCandidates),
        });
        if (this.sourceStep.begin(kind, start, candidates.length) !== 'continue') {
            this.sendResponse(req, false, 'Source step exceeded the instruction budget');
            return true;
        }
        this.sourceStepAddresses = [];
        for (const address of candidates) {
            if (!await this.breakpoints.acquireTemporary(address)) {
                await this.cancelSourceStep();
                this.sendResponse(req, false, this.breakpoints.temporaryError ?? 'Unable to set a source step breakpoint');
                return true;
            }
            this.sourceStepAddresses.push(address);
        }
        this.execution.pendingStep = true;
        this.sendResponseBody(req, {});
        if (candidates.length === 0) {
            await this.singleStep();
            return true;
        }
        await this.run();
        return true;
    }

    private async cancelSourceStep(): Promise<void> {
        await this.sourceStep.cancel();
        this.sourceStepFilters = [];
    }

    private async releaseSourceStepBreakpoints(): Promise<void> {
        const addresses = this.sourceStepAddresses;
        this.sourceStepAddresses = [];
        await Promise.all(addresses.map(address => this.breakpoints.releaseTemporary(address)));
    }

    private async singleStep(): Promise<void> { if (this.client) { await this.execution.singleStep(); } }

    // -----------------------------------------------------------------------
    // setBreakpoints — source breakpoints (Step 3.11 full impl requires ELF/DWARF)
    // -----------------------------------------------------------------------

    private async onSetBreakpoints(req: DapRequest): Promise<void> {
        this.sendResponseBody(req, { breakpoints: await this.breakpoints.setSource(req.arguments ?? {}) });
    }

    private async onSetInstructionBreakpoints(req: DapRequest): Promise<void> {
        this.sendResponseBody(req, { breakpoints: await this.breakpoints.setInstructions(req.arguments ?? {}) });
    }

    private async onDataBreakpointInfo(req: DapRequest): Promise<void> {
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

    private async onSetDataBreakpoints(req: DapRequest): Promise<void> {
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
                const dapId = this.breakpoints.allocateId();
                this.dapWatchpointIds.add(entry.id);
                this.watchpointIdToDapId.set(entry.id, dapId);
                result.push({ id: dapId, verified: true });
            }
            this.sendResponseBody(req, { breakpoints: result });
        } catch (error) {
            this.sendResponse(req, false, error instanceof Error ? error.message : String(error));
        }
    }

    private async onExceptionInfo(req: DapRequest): Promise<void> {
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
    // evaluate — one typed expression path for Watch, Console, and hover
    // -----------------------------------------------------------------------

    private async onEvaluate(req: DapRequest): Promise<void> {
        const expression = String(req.arguments?.expression ?? '').trim();
        const frameId = req.arguments?.frameId;
        const context = this.stopContext;
        const metadata = this.debugMetadata;
        const frame = context && typeof frameId === 'number'
            ? this.stackTraceService.frame(this.stoppedGeneration, frameId)
            : undefined;
        if (context && typeof frameId === 'number' && !frame) {
            this.sendResponse(req, false, 'The selected frame is no longer available');
            return;
        }

        // ASM has one hover owner, with definition links and instruction-aware
        // register pairs. Native C debug hovers continue to use this evaluator.
        const source = frame?.source ?? this.debugIndex?.resolveAddress(frame?.instructionPc ?? context?.pc ?? 0);
        const assemblerFrame = source ? isAssemblerSource(source.file)
            : this.debugIndex?.sourceFiles.length && this.debugIndex.sourceFiles.every(isAssemblerSource);
        if (req.arguments?.context === 'hover' && assemblerFrame) {
            this.sendResponse(req, false, 'Assembler hovers are provided by the language provider');
            return;
        }

        try {
            const regs = frame ? undefined : context ? this.cachedRegs : await this.safeGetRegs();
            const physicalFrame = frame?.physicalFrame ?? (context ? {
                index: 0, pc: context.pc, sp: context.sp, registers: context.topRegisters,
            } : undefined);
            const variables = metadata && context
                ? this.scopeService.scopes(metadata, frame ?? { instructionPc: context.pc })
                    .flatMap(scope => scope.variables)
                : [];
            const generation = this.stoppedGeneration;
            const result = await this.evaluateExpression(req.arguments?.context, expression, {
                metadata, memory: context, frame: physicalFrame, variables,
                symbols: this.debugIndex ?? undefined,
                registers: regs ? toDwarfRegisters(regs) : undefined,
                machineRegister: name => regs ? this.evalExpression(name.toUpperCase(), regs) : undefined,
                assertCurrent: () => {
                    this.sessionLease?.assertCurrent();
                    if (generation !== this.stoppedGeneration) { throw new Error('Evaluation belongs to an inactive stop'); }
                },
            });
            const variable = dapVariableValue(result.value, expression);
            const dapResult = context ? this.withVariableHandle(variable, context, 0) : variable;
            this.sendResponseBody(req, { result: dapResult.value, type: dapResult.type, memoryReference: dapResult.memoryReference, variablesReference: dapResult.variablesReference, namedVariables: dapResult.namedVariables, indexedVariables: dapResult.indexedVariables });
        } catch (error) {
            this.sendResponse(req, false, error instanceof Error ? error.message : String(error));
        }
    }

    private async evaluateExpression(
        context: unknown,
        expression: string,
        evaluationContext: ValueEvaluationContext,
    ): Promise<import('../values/c-expression-service').ExpressionValue> {
        const evaluation = this.valueEvaluationService.evaluate(expression, evaluationContext);
        if (!isHoverEvaluation(context)) { return evaluation; }
        let timeout: NodeJS.Timeout | undefined;
        try {
            return await Promise.race([
                evaluation,
                new Promise<never>((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Hover evaluation timed out')), HOVER_EVALUATION_TIMEOUT_MS);
                }),
            ]);
        } finally {
            if (timeout) { clearTimeout(timeout); }
        }
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

        return undefined;
    }

    private async onRestart(req: DapRequest): Promise<void> {
        try { await this.execution.restart('restart'); this.sendResponseBody(req, {}); }
        catch (error) { this.sendResponse(req, false, error instanceof Error ? error.message : String(error)); }
    }

    async reset(): Promise<void> { await this.execution.restart('reset'); }

    async reloadRom(): Promise<void> {
        if (!this.launchRequest?.program.toLowerCase().endsWith('.rom')) { throw new Error('Reload ROM is only available for ROM debug sessions'); }
        const request = this.launchRequest;
        const lease = this.sessionLease;
        await this.execution.restart('reload', () => this.lifecycle.reloadDebugRom(request, lease));
    }

    private async onDisconnect(req: DapRequest): Promise<void> {
        const terminateDebuggee = req.arguments?.terminateDebuggee ?? (this.emulatorProcess !== null);
        this.terminationRequested = true;
        try { await this.cleanup(terminateDebuggee); }
        catch (error) { this.terminationRequested = false; this.sendResponse(req, false, error instanceof Error ? error.message : String(error)); return; }
        this.sendResponseBody(req, {}); this.emitTerminated();
    }

    private async onTerminate(req: DapRequest): Promise<void> {
        this.terminationRequested = true;
        try { await this.cleanup(true); }
        catch (error) { this.terminationRequested = false; this.sendResponse(req, false, error instanceof Error ? error.message : String(error)); return; }
        this.sendResponseBody(req, {}); this.emitTerminated();
    }

    // -----------------------------------------------------------------------
    // Stop polling
    // -----------------------------------------------------------------------

    private startPoll(): void { this.execution.startPoll(); }
    private stopPoll(): void { this.execution.stopPoll(); }

    // -----------------------------------------------------------------------
    // Stop handling
    // -----------------------------------------------------------------------

    private async onStop(record?: StopRecord): Promise<void> {
        await this.refreshRegs();
        this.captureStopContext();
        if (!this.sourceStep.active && this.sourceStepAddresses.length > 0) {
            await this.releaseSourceStepBreakpoints();
        }

        const stoppedAtStepOver = this.pendingStepOverAddr !== undefined
            && ((record?.reason === 'breakpoint' && record.breakpointAddress === this.pendingStepOverAddr)
                || (record === undefined && this.cachedRegs?.pc === this.pendingStepOverAddr));
        if (stoppedAtStepOver && this.pendingStepOverAddr !== undefined) {
            await this.breakpoints.releaseTemporary(this.pendingStepOverAddr);
            this.pendingStepOverAddr = undefined;
        }
        await this.syncServerBreakpoints();
        const higherPriorityStop = this.execution.pendingPause
            || record?.reason === 'breakpoint' && record.breakpointAddress !== undefined
                && !!this.breakpoints.at(record.breakpointAddress)
            || record?.reason === 'watchpoint' || record?.reason === 'exception'
            || record?.reason === 'script' || record?.reason === 'pause';
        if (!higherPriorityStop && this.sourceStep.active && this.cachedRegs) {
            const pc = this.cachedRegs.pc;
            const location = this.debugIndex && this.debugMetadata
                ? new LogicalLocationIndex(this.debugIndex, this.debugMetadata).at(pc, 'top')
                : undefined;
            const outcome = location && !this.sourceStepFilters.some(filter => matchesSourceFilter(location.location.file, filter))
                ? await this.sourceStep.observe({
                    location: location.location,
                    physicalDepth: 0,
                    inlineDepth: this.debugMetadata?.inlineChainAt(pc).length ?? 0,
                }, this.sourceStepAddresses.length === 0 ? 1 : 0)
                : await this.sourceStep.tick();
            if (outcome === 'continue') {
                if (this.sourceStepAddresses.length === 0) {
                    await this.singleStep();
                } else {
                    await this.run();
                }
                return;
            }
            if (outcome !== 'complete') {
                this.execution.pendingStep = false;
                this.sendEvent('output', { category: 'stderr', output: `V6: Source step ${outcome.replace(/-/g, ' ')}.\n` });
            }
        }
        if (record) {
            if (record.reason === 'breakpoint' && record.breakpointAddress !== undefined) {
                const breakpoint = this.breakpoints.at(record.breakpointAddress);
                if (breakpoint?.logMessage) {
                    await this.cancelSourceStep();
                    try {
                        this.sendEvent('output', { category: 'console', output: this.breakpoints.formatLogMessage(breakpoint.logMessage) });
                    } catch (error) {
                        this.sendEvent('output', { category: 'stderr', output: `V6: logpoint ${hex4(breakpoint.address)} failed: ${String(error)}\n` });
                    }
                    await this.resumeLogpoint();
                    return;
                }
            }
            if (record.reason === 'breakpoint' && record.breakpointAddress !== undefined
                && !!this.breakpoints.at(record.breakpointAddress)) {
                await this.cancelSourceStep();
            } else if (record.reason === 'watchpoint' || record.reason === 'exception'
                || record.reason === 'script' || record.reason === 'pause') {
                await this.cancelSourceStep();
            }
            this.execution.pendingStep = false;
            this.execution.pendingPause = false;
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

        if (this.execution.pendingStep) {
            reason = 'step';
            this.execution.pendingStep = false;
        } else if (this.execution.pendingPause) {
            reason = 'pause';
            this.execution.pendingPause = false;
        } else if (pc !== undefined) {
            const bpId = this.breakpoints.idAt(pc);
            if (bpId !== undefined) {
                reason = 'breakpoint';
                hitBreakpointIds = [bpId];
            }
        }

        this.stopReason = reason;
        this.emitStopped(reason, hitBreakpointIds);
    }

    private async resumeLogpoint(): Promise<void> {
        if (!await this.execution.resumeLogpoint()) { this.emitStopped('breakpoint', undefined, 'Logpoint automatic resume failed.'); }
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

    private mapHitBreakpointIds(record: StopRecord): number[] | undefined {
        if (record.reason === 'breakpoint') {
            const addresses = [record.breakpointAddress, ...(record.breakpointIds ?? [])]
                .filter((value): value is number => value !== undefined);
            const ids = addresses.map(address => this.breakpoints.idAt(address))
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
        try {
            for (const change of await this.breakpoints.synchronize()) {
                const breakpoint = change.breakpoint;
                if (!breakpoint) { this.sendEvent('breakpoint', { reason: 'removed', breakpoint: { id: change.id } }); continue; }
                const sourceLocation = this.debugIndex?.resolveAddress(breakpoint.addr);
                const sourcePath = sourceLocation ? resolveDebugSourcePath(sourceLocation.file, this.workspaceRoot) : undefined;
                this.sendEvent('breakpoint', { reason: 'new', breakpoint: {
                    id: change.id, verified: breakpoint.status === 'ACTIVE', instructionReference: hex4(breakpoint.addr),
                    message: breakpoint.comment || undefined,
                    source: sourcePath ? { name: path.basename(sourcePath), path: sourcePath, sourceReference: 0 } : undefined,
                    line: sourceLocation?.line, column: sourceLocation?.column,
                } });
            }
        } catch (error) { this.logger.debug(`v6-debug: breakpoint synchronization unavailable: ${String(error)}`); }
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

    private invalidateStopContext(): void {
        this.stoppedGeneration++;
        this.stopContext = undefined;
        this.stackTraceService.clear();
        this.variablesHandles.reset(this.stoppedGeneration);
    }

    private captureStopContext(): void {
        if (!this.debugMetadata || !this.client || !this.cachedRegs) { return; }
        this.stoppedGeneration++;
        const generation = this.stoppedGeneration;
        this.stopContext = DebugStopContext.from(this.debugMetadata, this.client, this.cachedRegs,
            memoryCapabilities(this.lifecycle.serverInfo) ?? null,
            () => { if (generation !== this.stoppedGeneration) { throw new Error('Stopped memory context is inactive'); } });
        this.variablesHandles.reset(this.stoppedGeneration);
    }

    private async cleanup(terminateDebuggee: boolean): Promise<void> {
        const lease = this.sessionLease;
        const current = !lease || lease.connected;
        const ownedTermination = current && terminateDebuggee && this.lifecycle.owner === 'debug';
        // A required save may fail. Do not discard the DAP session before it can be retried.
        if (ownedTermination) { await this.lifecycle.stop(); }
        this.stopPoll();
        await this.cancelSourceStep();
        await this.releaseSourceStepBreakpoints();
        this.execution.state = 'disconnected';
        this.clearUnavailableSourceIndicator();
        this.unavailableSourceDecoration?.dispose();
        this.unavailableSourceDecoration = undefined;
        this.lastResolvedSource = undefined;

        // Remove all DAP-owned breakpoints
        if (current && this.client?.connected) {
            if (this.watchpointService?.available) {
                for (const id of this.dapWatchpointIds) {
                    await this.watchpointService.delete(id).catch(() => {});
                }
            }
            for (const addr of this.breakpoints.ownedAddresses()) {
                await this.client.send(IpcCommand.DEBUG_BREAKPOINT_DEL, { addr }).catch(() => {});
            }
            await this.client.send(IpcCommand.DEBUG_ATTACH, { data: false }).catch(() => {});
            if (terminateDebuggee && this.lifecycle.owner !== 'debug' && !lease) {
                await this.client.send(IpcCommand.EXIT, {}).catch(() => {});
            }
            // Both borrowed attach and owned launch detach through the coordinator.
            if (!ownedTermination && (!lease || lease.connected)) { this.lifecycle.disconnect(); }
        }

        this.breakpoints.clear();
        this.watchpointIdToDapId.clear();
        this.dapWatchpointIds.clear();
        this.client = null;
        this.sessionLease = undefined;
        this.emulatorProcess = null;
        this.cachedRegs = null;
        this.invalidateStopContext();
        this.stopRecordsSupported = false;
        this.execution.lastStopSequence = undefined;
        this.lastExceptionRecord = undefined;
    }

    private emitTerminated(exitCode?: number): void {
        if (this.terminationEmitted) { return; }
        this.terminationEmitted = true;
        this.stopPoll();
        this.execution.state = 'disconnected';
        if (exitCode !== undefined) {
            this.sendEvent('exited', { exitCode });
        }
        this.sendEvent('terminated');
    }

    // -----------------------------------------------------------------------
    // DAP message helpers
    // -----------------------------------------------------------------------

    private sendResponseBody(req: DapRequest, body: unknown): void {
        this._onDidSendMessage.fire({
            type: 'response',
            request_seq: req.seq,
            success: true,
            command: req.command,
            body,
        } satisfies DapResponse);
    }

    private sendResponse(req: DapRequest, success: boolean, message?: string): void {
        this._onDidSendMessage.fire({
            type: 'response',
            request_seq: req.seq,
            success,
            command: req.command,
            message,
            body: {},
        } satisfies DapResponse);
    }

    private sendEvent(event: string, body?: unknown): void {
        this._onDidSendMessage.fire({
            type: 'event',
            event,
            body: body ?? {},
        } satisfies DapEvent);
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

function matchesSourceFilter(sourcePath: string, glob: string): boolean {
    const escape = (value: string) => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    const globStarToken = '__V6_GLOBSTAR__';
    const pattern = escape(path.normalize(glob).replace(/\\/g, '/'))
        .replace(/\*\*/g, globStarToken)
        .replace(/\*/g, '[^/]*')
        .replace(new RegExp(globStarToken, 'g'), '.*');
    return new RegExp(`^${pattern}$`, process.platform === 'win32' ? 'i' : '').test(
        path.normalize(sourcePath).replace(/\\/g, '/'),
    );
}
