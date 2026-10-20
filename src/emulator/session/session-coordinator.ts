import * as fs from 'fs';
import * as net from 'net';
import { EventEmitter } from 'events';
import { V6Project } from '../../project/model/v6-project';
import { V6emulLocator } from '../launcher/v6emul-locator';
import { V6emulLauncher, EmulatorProcess } from '../launcher/v6emul-launcher';
import { IpcClient } from '../client/ipc-client';
import {
    GetServerInfoResponse,
    IpcCommand,
    PingResponse,
    IpcResponse,
    SetMemRequest,
    SPEED_VALUES,
} from '../protocol/ipc-commands';
import { getServerInfo, validateDebuggerServer } from '../protocol/ipc-server-info';
import { Logger } from '../../platform/logging/logger';
import { PathService } from '../../platform/files/path-service';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';
import type { OperationScope } from '../../platform/async/scoped-task-queue';
import { requireProtocolOk } from '../protocol/protocol-result';
import { InactiveSessionError } from './session-operations';

const DEFAULT_TCP_PORT = 9876;
const CONNECT_RETRY_DELAY_MS = 300;
const CONNECT_MAX_RETRIES = 10;

// SessionCoordinator is intentionally observed by many subsystems: the debug
// services (scripts, ports, watchpoints, memory edits, performance, trace log,
// hardware statistics) each register a state listener, as do the panels and
// providers (emulator display, hex viewer, memory edits, performance, trace
// log, scripts, symbols, watchpoints). Node.js emits a
// MaxListenersExceededWarning once more than 10 listeners attach to a single
// event name, so raise the cap to the number of known subscribers plus
// headroom for transient panel listeners.
const MAX_LISTENERS_PER_EVENT = 24;

export type EmulatorState = 'stopped' | 'launching' | 'connected' | 'running';
export type EmulatorFrameMode = 'full' | 'border' | 'borderless';
export type EmulatorSessionOwner = 'run' | 'debug' | null;

export interface DebugLaunchRequest {
    program: string;
    bootRomPath: string;
    loadAddr?: string;
    speed?: string;
    fddReadOnly?: boolean;
}

export interface SessionProgram {
    readonly executable: string;
    readonly fddReadOnly: boolean;
}

export interface StopContext extends OperationScope {
    readonly owner: EmulatorSessionOwner;
    readonly program: SessionProgram | undefined;
    assertCurrent(): void;
}

export type StopParticipant = (context: StopContext) => Promise<void>;

export interface SessionLease extends OperationScope {
    readonly connected: boolean;
    send<T = unknown>(command: IpcCommand, data?: unknown, timeout?: number,
        priority?: 'critical' | 'high' | 'normal' | 'low'): Promise<IpcResponse<T>>;
}

export interface ConnectionSnapshot {
    readonly connection: 'disconnected' | 'connecting' | 'connected';
    readonly execution: 'unknown' | 'paused' | 'running';
    readonly ownership: 'owned' | 'borrowed' | 'none';
    readonly mode: 'run' | 'debug' | 'attach' | undefined;
    readonly debuggerAttached: boolean;
}

export class SessionCoordinator extends EventEmitter {
    private readonly locator: V6emulLocator;
    private readonly launcher: V6emulLauncher;
    private readonly client: IpcClient;
    private readonly logger: Logger;
    private readonly pathService: PathService;

    private emulatorProcess: EmulatorProcess | null = null;
    private _state: EmulatorState = 'stopped';
    private _frameMode: EmulatorFrameMode = 'borderless';
    private _owner: EmulatorSessionOwner = null;
    private _serverInfo: GetServerInfoResponse | undefined;
    private program: SessionProgram | undefined;
    private readonly stopParticipants = new Set<StopParticipant>();
    private stopInFlight: Promise<void> | undefined;
    private transitionTail: Promise<void> = Promise.resolve();
    private requestId = 0;
    private opening = false;
    private sessionKey: object = {};
    private mode: 'run' | 'debug' | 'attach' | undefined;
    private debuggerAttached = false;

    constructor(
        locator: V6emulLocator,
        launcher: V6emulLauncher,
        client: IpcClient,
        logger: Logger,
        pathService: PathService,
    ) {
        super();
        this.setMaxListeners(MAX_LISTENERS_PER_EVENT);
        this.locator = locator;
        this.launcher = launcher;
        this.client = client;
        this.logger = logger;
        this.pathService = pathService;
        this.client.on?.('disconnect', () => {
            this.sessionKey = {};
            this._serverInfo = undefined;
            this.debuggerAttached = false;
            if (!this.opening) { this.setState('stopped'); }
        });
    }

    get state(): EmulatorState {
        return this._state;
    }

    get frameMode(): EmulatorFrameMode {
        return this._frameMode;
    }

    get owner(): EmulatorSessionOwner {
        return this._owner;
    }

    get ipcClient(): IpcClient {
        return this.client;
    }

    get running(): boolean {
        return this._state === 'running';
    }

    get connected(): boolean {
        return this._state === 'connected' || this._state === 'running';
    }

    get serverInfo(): GetServerInfoResponse | undefined {
        return this._serverInfo;
    }

    get connectionSnapshot(): ConnectionSnapshot {
        return Object.freeze({
            connection: this._state === 'launching' ? 'connecting' : this.connected ? 'connected' : 'disconnected',
            execution: this.running ? 'running' : this.connected ? 'paused' : 'unknown',
            ownership: this.mode === 'attach' ? 'borrowed' : this._owner ? 'owned' : 'none',
            mode: this.mode, debuggerAttached: this.debuggerAttached,
        });
    }

    captureSession(): SessionLease {
        const key = this.sessionKey;
        const epoch = this.client.connectionEpoch;
        const openingRequest = this.opening ? this.requestId : undefined;
        const transport = this.client;
        const assertCurrent = () => {
            if (key !== this.sessionKey || epoch !== this.client.connectionEpoch || !this.client.connected) {
                throw new InactiveSessionError();
            }
            if (openingRequest !== undefined && openingRequest !== this.requestId) { throw new InactiveSessionError(); }
        };
        assertCurrent();
        return {
            key, assertCurrent,
            get connected() { try { assertCurrent(); return true; } catch { return false; } },
            async send<T>(command: IpcCommand, data?: unknown, timeout?: number, priority?: 'critical' | 'high' | 'normal' | 'low') {
                assertCurrent();
                const response = await transport.send<T>(command, data, timeout, priority, { key, assertCurrent });
                assertCurrent();
                return response;
            },
        };
    }

    private submitTransition<T>(operation: (id: number) => Promise<T>): Promise<T> {
        const id = ++this.requestId;
        if (this.opening) { this.client.disconnect(); }
        const result = this.transitionTail.then(async () => {
            this.assertRequest(id);
            return operation(id);
        });
        this.transitionTail = result.then(() => undefined, () => undefined);
        return result;
    }

    private assertRequest(id: number): void {
        if (id !== this.requestId) { throw new InactiveSessionError(); }
    }

    start(project: V6Project): Promise<void> {
        return this.submitTransition(async id => {
            await this.stopNow('normal');
            this.assertRequest(id);
            return this.startRunNow(project, id);
        });
    }

    private async startRunNow(project: V6Project, id: number): Promise<void> {
        this.opening = true;
        this.sessionKey = {};
        this.mode = 'run';
        this.setState('launching');
        this._owner = 'run';
        this.recordLoadedProgram(project.run.executable, project.run.fddReadOnly ?? false);

        try {
            const emulatorPath = this.locator.resolve();
            const port = DEFAULT_TCP_PORT;

            const bootRomPath = project.run.bootRom
                ? project.run.bootRom
                : this.pathService.resolveExtensionPath('res/boot/boots.bin');

            const isRom = !project.run.executable.endsWith('.fdd');
            const romPath = isRom ? project.run.executable : undefined;
            const fddPath = !isRom ? project.run.executable : undefined;

            this.emulatorProcess = this.launcher.launch({
                emulatorPath,
                romPath,
                loadAddr: project.run.loadAddr,
                bootRomPath,
                fddPath,
                fddAutoboot: fddPath ? true : undefined,
                speed: project.run.speed,
                tcpPort: port,
            });

            this.monitorProcess(this.emulatorProcess);

            // Connect with retries (emulator needs time to start TCP server)
            const serverInfo = await this.negotiate(port, '127.0.0.1', false, id, true);
            const session = this.captureSession();

            const frameMode = this.resolveFrameMode(project.run.viewMode);
            await session.send(IpcCommand.SET_FRAME_MODE, { frameMode: frameMode.value });
            this.updateFrameMode(frameMode.panelMode);
            await session.send(IpcCommand.SET_COLOR_FORMAT, { colorFormat: 0 });

            // Load ROM or mount FDD via IPC
            if (romPath) {
                const romData = Array.from(fs.readFileSync(romPath));
                const addr = project.run.loadAddr ? parseInt(project.run.loadAddr, 16) : 0x100;
                await session.send(IpcCommand.LOAD_ROM, {
                    data: romData,
                    addr,
                    autorun: true,
                });
                this.logger.info(`v6emul: ROM loaded at 0x${addr.toString(16)}`);
            } else if (fddPath) {
                const fddData = Array.from(fs.readFileSync(fddPath));
                await session.send(IpcCommand.MOUNT_FDD, {
                    data: fddData,
                    driveIdx: 0,
                    path: fddPath,
                    autoBoot: true,
                });
                this.logger.info(`v6emul: FDD mounted from "${fddPath}"`);
            }

            if (serverInfo.commands.includes(IpcCommand.DEBUG_ATTACH)) {
                requireProtocolOk(IpcCommand.DEBUG_ATTACH, await session.send(IpcCommand.DEBUG_ATTACH, { data: true }), 'Unable to enable debugger');
                this.debuggerAttached = true;
            }

            // Set speed if specified
            if (project.run.speed && SPEED_VALUES[project.run.speed] !== undefined) {
                await session.send(IpcCommand.SET_CPU_SPEED, {
                    speed: SPEED_VALUES[project.run.speed],
                });
            }

            this.assertRequest(id);
            this.setState('running');
            this.logger.info('v6emul: emulator running');

        } catch (err) {
            this.logger.error(`v6emul start failed: ${err instanceof Error ? err.message : String(err)}`);
            this.cleanup();
            this._owner = null;
            this.setState('stopped');
            throw err instanceof V6Error ? err : new V6Error(
                ErrorCode.EMULATOR_LAUNCH_FAILED,
                `Failed to start emulator: ${err instanceof Error ? err.message : String(err)}`,
                err instanceof Error ? err : undefined,
            );
        } finally { this.opening = false; }
    }

    startDebug(request: DebugLaunchRequest): Promise<{ client: IpcClient; process: EmulatorProcess; port: number }> {
        return this.submitTransition(async id => {
            await this.stopNow('normal');
            this.assertRequest(id);
            return this.startDebugNow(request, id);
        });
    }

    private async startDebugNow(request: DebugLaunchRequest, id: number): Promise<{ client: IpcClient; process: EmulatorProcess; port: number }> {
        this.opening = true;
        this.sessionKey = {};
        this.mode = 'debug';
        this.setState('launching');
        this._owner = 'debug';

        try {
            const port = await this.findFreePort();
            this.assertRequest(id);
            this.emulatorProcess = this.launcher.launch({
                emulatorPath: this.locator.resolve(),
                tcpPort: port,
                bootRomPath: request.bootRomPath,
                speed: request.speed ?? '100%',
            });
            const process = this.emulatorProcess;
            this.monitorProcess(process);

            await this.negotiate(port, '127.0.0.1', true, id, true);
            const session = this.captureSession();
            await session.send(IpcCommand.SET_COLOR_FORMAT, { colorFormat: 0 });
            requireProtocolOk(IpcCommand.STOP, await session.send(IpcCommand.STOP), 'Unable to pause emulator');
            this.assertRequest(id);
            this.setState('connected');
            return { client: this.client, process, port };
        } catch (err) {
            this.cleanup();
            this._owner = null;
            this.setState('stopped');
            throw err;
        } finally { this.opening = false; }
    }

    attach(port: number, host = '127.0.0.1'): Promise<SessionLease> {
        return this.submitTransition(async id => {
            if (this._owner) { throw new Error('Stop the owned emulator before attaching to an external session'); }
            this.disconnectCurrent();
            this.opening = true;
            this.mode = 'attach';
            this.setState('launching');
            try {
                await this.negotiate(port, host, true, id, false);
                const session = this.captureSession();
                requireProtocolOk(IpcCommand.STOP, await session.send(IpcCommand.STOP), 'Unable to pause attached emulator');
                this.assertRequest(id);
                this.setState('connected');
                return session;
            } catch (error) {
                this.disconnectCurrent();
                throw error;
            } finally { this.opening = false; }
        });
    }

    private async negotiate(port: number, host: string, debugging: boolean, id: number, retry: boolean): Promise<GetServerInfoResponse> {
        if (retry) { await this.connectWithRetries(port, id); }
        else { await this.client.connect(port, host); }
        this.assertRequest(id);
        const session = this.captureSession();
        const info = await getServerInfo(session);
        if (debugging) { validateDebuggerServer(info); }
        requireProtocolOk(IpcCommand.PING, await session.send<PingResponse>(IpcCommand.PING), 'PING health check failed');
        this.assertRequest(id);
        this._serverInfo = info;
        if (debugging) {
            requireProtocolOk(IpcCommand.DEBUG_ATTACH, await session.send(IpcCommand.DEBUG_ATTACH, { data: true }), 'Unable to attach debugger');
            this.debuggerAttached = true;
        }
        this.logger.info(`v6emul: ${info.emulatorVersion}, IPC protocol ${info.protocolVersion}`);
        return info;
    }

    async loadDebugProgram(request: DebugLaunchRequest, expected?: OperationScope): Promise<void> {
        expected?.assertCurrent();
        if (!this.connected) {
            throw new V6Error(ErrorCode.EMULATOR_LAUNCH_FAILED, 'Debug emulator is not connected');
        }
        const session = this.captureSession();

        if (request.program.toLowerCase().endsWith('.fdd')) {
            const fddData = Array.from(fs.readFileSync(request.program));
            requireProtocolOk(IpcCommand.MOUNT_FDD, await session.send(IpcCommand.MOUNT_FDD, {
                data: fddData,
                driveIdx: 0,
                path: request.program,
                autoBoot: true,
            }), 'Unable to mount debug FDD');
            this.recordLoadedProgram(request.program, request.fddReadOnly ?? false);
            this.logger.info(`v6emul: debug FDD mounted from "${request.program}"`);
            return;
        }

        const romData = Array.from(fs.readFileSync(request.program));
        const addr = request.loadAddr ? parseInt(request.loadAddr, 16) : 0x100;
        requireProtocolOk(IpcCommand.LOAD_ROM, await session.send(IpcCommand.LOAD_ROM, {
            data: romData,
            addr,
            autorun: false,
        }), 'Unable to load debug ROM');
        this.recordLoadedProgram(request.program, request.fddReadOnly ?? false);
        this.logger.info(`v6emul: debug ROM loaded at 0x${addr.toString(16)}`);
    }

    async reloadDebugRom(request: DebugLaunchRequest, expected?: OperationScope): Promise<void> {
        expected?.assertCurrent();
        if (!this.connected) {
            throw new V6Error(ErrorCode.EMULATOR_LAUNCH_FAILED, 'Debug emulator is not connected');
        }
        if (!request.program.toLowerCase().endsWith('.rom')) {
            throw new V6Error(ErrorCode.EMULATOR_LAUNCH_FAILED, 'Reload ROM is only available for ROM debug sessions');
        }

        const data: SetMemRequest = {
            data: Array.from(fs.readFileSync(request.program)),
            addr: request.loadAddr ? parseInt(request.loadAddr, 16) : 0x100,
            autorun: false,
        };
        const response = await this.captureSession().send(IpcCommand.SET_MEM, data, 5000, 'critical');
        if (!response.ok) {
            throw new V6Error(ErrorCode.EMULATOR_LAUNCH_FAILED, response.error ?? 'Unable to reload debug ROM');
        }
        this.logger.info(`v6emul: debug ROM reloaded at 0x${data.addr.toString(16)}`);
    }

    setExecutionRunning(running: boolean, expected?: OperationScope): void {
        expected?.assertCurrent();
        if (this.connected) {
            this.setState(running ? 'running' : 'connected');
        }
    }

    async stopFromDisplay(): Promise<void> {
        await this.stop();
    }

    recordLoadedProgram(executable: string, fddReadOnly: boolean): void {
        this.program = Object.freeze({ executable, fddReadOnly });
    }

    async reloadRunProgram(project: V6Project): Promise<void> {
        const session = this.captureSession();
        const bytes = Array.from(fs.readFileSync(project.run.executable));
        const fdd = project.run.executable.toLowerCase().endsWith('.fdd');
        const command = fdd ? IpcCommand.MOUNT_FDD : IpcCommand.LOAD_ROM;
        const data = fdd ? { data: bytes, driveIdx: 0, path: project.run.executable, autoBoot: true }
            : { data: bytes, addr: project.run.loadAddr ? parseInt(project.run.loadAddr, 16) : 0x100, autorun: true };
        requireProtocolOk(command, await session.send(command, data), 'Unable to reload program');
        this.recordLoadedProgram(project.run.executable, project.run.fddReadOnly ?? false);
    }

    registerStopParticipant(participant: StopParticipant): { dispose(): void } {
        this.stopParticipants.add(participant);
        return { dispose: () => { this.stopParticipants.delete(participant); } };
    }

    /** Required participant failures abort normal stops; shutdown must still release resources. */
    stop(reason: 'normal' | 'shutdown' = 'normal'): Promise<void> {
        if (this.stopInFlight) { return this.stopInFlight; }
        const result = this.submitTransition(() => this.stopNow(reason));
        this.stopInFlight = result;
        const clear = () => { if (this.stopInFlight === result) { this.stopInFlight = undefined; } };
        void result.then(clear, clear);
        return result;
    }

    async shutdown(): Promise<void> {
        try { await this.stop('shutdown'); }
        catch (error) {
            // A normal stop may already have been in flight when shutdown began.
            this.logger.error(`v6emul shutdown: ${error instanceof Error ? error.message : String(error)}`);
            await this.stop('shutdown');
        }
    }

    private async stopNow(reason: 'normal' | 'shutdown'): Promise<void> {
        if (this._state === 'stopped' && !this.emulatorProcess) { return; }
        if (this.mode === 'attach') {
            if (this.client.connected && this.debuggerAttached) {
                const session = this.captureSession();
                await session.send(IpcCommand.DEBUG_ATTACH, { data: false }).catch(() => {});
            }
            this.disconnectCurrent();
            return;
        }
        const process = this.emulatorProcess;
        const owner = this._owner;
        const program = this.program;
        const epoch = this.client.connectionEpoch;
        const context: StopContext = {
            key: {}, owner, program,
            assertCurrent: () => {
                if (this.emulatorProcess !== process || this._owner !== owner || this.client.connectionEpoch !== epoch
                    || this.program !== program || !this.client.connected) { throw new Error('Stop belongs to an inactive emulator connection'); }
            },
        };
        this.logger.info('v6emul: stopping...');
        if (this.client.connected) {
            await this.client.send(IpcCommand.STOP, undefined, 5000, 'high', context).catch(() => {});
            this.setExecutionRunning(false);
            try {
                context.assertCurrent();
                for (const participant of [...this.stopParticipants]) {
                    await participant(context);
                    context.assertCurrent();
                }
            } catch (error) {
                this.logger.error(`v6emul stop participant: ${error instanceof Error ? error.message : String(error)}`);
                if (reason !== 'shutdown') { throw error; }
            }
            if (this.emulatorProcess === process && this.client.connectionEpoch === epoch) {
                await this.client.send(IpcCommand.EXIT).catch(() => {});
            }
        }
        if (process) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                await Promise.race([process.spawnResult.exitPromise.catch(() => {}),
                    new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); })]);
            } finally { clearTimeout(timer); }
        }
        // A monitor/detach may already have cleared this session. Never clean up a replacement.
        if (this.emulatorProcess !== process || this._owner !== owner || this.client.connectionEpoch !== epoch) { return; }
        this.cleanup();
        this._owner = null;
        this.setState('stopped');
        this.logger.info('v6emul: stopped');
    }

    disconnect(): void {
        this.requestId++;
        this.disconnectCurrent();
    }

    private disconnectCurrent(): void {
        this.sessionKey = {};
        this.client.disconnect();
        this.emulatorProcess = null;
        this._serverInfo = undefined;
        this._owner = null;
        this.program = undefined;
        this.mode = undefined;
        this.debuggerAttached = false;
        this.setState('stopped');
        this.logger.info('v6emul: disconnected');
    }

    restart(project: V6Project): Promise<void> {
        return this.start(project);
    }

    async setFrameMode(frameMode: EmulatorFrameMode): Promise<void> {
        const session = this.captureSession();
        const frameModeValue = frameMode === 'full' ? 0 : frameMode === 'border' ? 1 : 2;
        await session.send(IpcCommand.SET_FRAME_MODE, { frameMode: frameModeValue });
        this.updateFrameMode(frameMode);
    }

    private async connectWithRetries(port: number, id: number): Promise<void> {
        for (let attempt = 1; attempt <= CONNECT_MAX_RETRIES; attempt++) {
            this.assertRequest(id);
            try {
                await this.client.connect(port);
                return;
            } catch (err) {
                this.assertRequest(id);
                if (attempt === CONNECT_MAX_RETRIES) {
                    throw new V6Error(
                        ErrorCode.IPC_CONNECTION_REFUSED,
                        `Failed to connect after ${CONNECT_MAX_RETRIES} attempts`,
                        err instanceof Error ? err : undefined,
                    );
                }
                this.logger.debug(`ipc connect attempt ${attempt}/${CONNECT_MAX_RETRIES} failed, retrying...`);
                await this.delay(CONNECT_RETRY_DELAY_MS);
            }
        }
    }

    private cleanup(): void {
        this.sessionKey = {};
        this.mode = undefined;
        this.debuggerAttached = false;
        this.program = undefined;
        this._serverInfo = undefined;
        this.client.disconnect();
        if (this.emulatorProcess) {
            try {
                this.emulatorProcess.spawnResult.process.kill();
            } catch {
                // Process may already be dead
            }
            this.emulatorProcess = null;
        }
    }

    private monitorProcess(process: EmulatorProcess): void {
        process.spawnResult.exitPromise.then((code) => {
            if (this.emulatorProcess !== process) { return; }
            this.logger.info(`v6emul process exited with code ${code}`);
            this.emulatorProcess = null;
            this.client.disconnect();
            this._serverInfo = undefined;
            this._owner = null;
            this.program = undefined;
            this.sessionKey = {};
            this.mode = undefined;
            this.debuggerAttached = false;
            this.setState('stopped');
            this.emit('exit', code);
        }).catch((err) => {
            if (this.emulatorProcess !== process) { return; }
            this.logger.error(`v6emul process error: ${err.message}`);
            this.emulatorProcess = null;
            this.client.disconnect();
            this._serverInfo = undefined;
            this._owner = null;
            this.program = undefined;
            this.sessionKey = {};
            this.mode = undefined;
            this.debuggerAttached = false;
            this.setState('stopped');
            this.emit('error', err);
        });
    }

    private findFreePort(): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const server = net.createServer();
            server.listen(0, '127.0.0.1', () => {
                const address = server.address() as net.AddressInfo;
                server.close(() => resolve(address.port));
            });
            server.on('error', reject);
        });
    }

    private setState(state: EmulatorState): void {
        if (this._state !== state) {
            this._state = state;
            this.emit('stateChange', state);
        }
    }

    private updateFrameMode(frameMode: EmulatorFrameMode): void {
        if (this._frameMode !== frameMode) {
            this._frameMode = frameMode;
            this.emit('frameModeChange', frameMode);
        }
    }

    private resolveFrameMode(viewMode: string | undefined): { value: number; panelMode: EmulatorFrameMode } {
        switch (viewMode) {
            case 'full':
                return { value: 0, panelMode: 'full' };
            case 'border':
                return { value: 1, panelMode: 'border' };
            default:
                return { value: 2, panelMode: 'borderless' };
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
