import * as fs from 'fs';
import * as net from 'net';
import { EventEmitter } from 'events';
import { V6Project } from '../../project/model/v6-project';
import { V6emulLocator } from '../launcher/v6emul-locator';
import { V6emulLauncher, EmulatorProcess } from '../launcher/v6emul-launcher';
import { IpcClient } from '../client/ipc-client';
import { IpcCommand, PingResponse, SPEED_VALUES } from '../protocol/ipc-commands';
import { getServerInfo, validateDebuggerServer } from '../protocol/ipc-server-info';
import { Logger } from '../../platform/logging/logger';
import { PathService } from '../../platform/files/path-service';
import { V6Error } from '../../platform/errors/v6-error';
import { ErrorCode } from '../../platform/errors/error-codes';

const DEFAULT_TCP_PORT = 9876;
const CONNECT_RETRY_DELAY_MS = 300;
const CONNECT_MAX_RETRIES = 10;

export type EmulatorState = 'stopped' | 'launching' | 'connected' | 'running';
export type EmulatorFrameMode = 'full' | 'border' | 'borderless';
export type EmulatorSessionOwner = 'run' | 'debug' | null;

export interface DebugLaunchRequest {
    program: string;
    bootRomPath: string;
    loadAddr?: string;
    speed?: string;
}

export class EmulatorLifecycle extends EventEmitter {
    private readonly locator: V6emulLocator;
    private readonly launcher: V6emulLauncher;
    private readonly client: IpcClient;
    private readonly logger: Logger;
    private readonly pathService: PathService;

    private emulatorProcess: EmulatorProcess | null = null;
    private _state: EmulatorState = 'stopped';
    private _frameMode: EmulatorFrameMode = 'borderless';
    private _owner: EmulatorSessionOwner = null;

    constructor(
        locator: V6emulLocator,
        launcher: V6emulLauncher,
        client: IpcClient,
        logger: Logger,
        pathService: PathService,
    ) {
        super();
        this.locator = locator;
        this.launcher = launcher;
        this.client = client;
        this.logger = logger;
        this.pathService = pathService;
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

    async start(project: V6Project): Promise<void> {
        if (this._state !== 'stopped') {
            await this.stop();
        }

        this.setState('launching');
        this._owner = 'run';

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

            // Monitor process exit
            this.emulatorProcess.spawnResult.exitPromise.then((code) => {
                this.logger.info(`v6emul process exited with code ${code}`);
                this.emulatorProcess = null;
                this.setState('stopped');
                this.emit('exit', code);
            }).catch((err) => {
                this.logger.error(`v6emul process error: ${err.message}`);
                this.emulatorProcess = null;
                this.setState('stopped');
                this.emit('error', err);
            });

            // Connect with retries (emulator needs time to start TCP server)
            await this.connectWithRetries(port);
            this.setState('connected');

            const serverInfo = await getServerInfo(this.client);
            this.logger.info(`v6emul: ${serverInfo.emulatorVersion}, IPC protocol ${serverInfo.protocolVersion}`);

            const pingResp = await this.client.send<PingResponse>(IpcCommand.PING);
            if (!pingResp.ok) {
                throw new V6Error(ErrorCode.EMULATOR_LAUNCH_FAILED, 'PING health check failed');
            }
            this.logger.info('v6emul: PING OK');

            const frameMode = this.resolveFrameMode(project.run.viewMode);
            await this.setFrameMode(frameMode.panelMode);
            await this.client.send(IpcCommand.SET_COLOR_FORMAT, { colorFormat: 0 });

            // Load ROM or mount FDD via IPC
            if (romPath) {
                const romData = Array.from(fs.readFileSync(romPath));
                const addr = project.run.loadAddr ? parseInt(project.run.loadAddr, 16) : 0x100;
                await this.client.send(IpcCommand.LOAD_ROM, {
                    data: romData,
                    addr,
                    autorun: true,
                });
                this.logger.info(`v6emul: ROM loaded at 0x${addr.toString(16)}`);
            } else if (fddPath) {
                const fddData = Array.from(fs.readFileSync(fddPath));
                await this.client.send(IpcCommand.MOUNT_FDD, {
                    data: fddData,
                    driveIdx: 0,
                    path: fddPath,
                    autoBoot: true,
                });
                this.logger.info(`v6emul: FDD mounted from "${fddPath}"`);
            }

            // Set speed if specified
            if (project.run.speed && SPEED_VALUES[project.run.speed] !== undefined) {
                await this.client.send(IpcCommand.SET_CPU_SPEED, {
                    speed: SPEED_VALUES[project.run.speed],
                });
            }

            this.setState('running');
            this.logger.info('v6emul: emulator running');

        } catch (err) {
            this.logger.error(`v6emul start failed: ${err instanceof Error ? err.message : String(err)}`);
            this.cleanup();
            this.setState('stopped');
            throw err instanceof V6Error ? err : new V6Error(
                ErrorCode.EMULATOR_LAUNCH_FAILED,
                `Failed to start emulator: ${err instanceof Error ? err.message : String(err)}`,
                err instanceof Error ? err : undefined,
            );
        }
    }

    async startDebug(request: DebugLaunchRequest): Promise<{ client: IpcClient; process: EmulatorProcess; port: number }> {
        if (this._state !== 'stopped') {
            await this.stop();
        }

        this.setState('launching');
        this._owner = 'debug';

        try {
            const port = await this.findFreePort();
            const isRom = !request.program.toLowerCase().endsWith('.fdd');
            this.emulatorProcess = this.launcher.launch({
                emulatorPath: this.locator.resolve(),
                tcpPort: port,
                bootRomPath: request.bootRomPath,
                romPath: isRom ? request.program : undefined,
                loadAddr: request.loadAddr,
                fddPath: isRom ? undefined : request.program,
                fddAutoboot: isRom ? undefined : true,
                speed: request.speed ?? '100%',
            });
            const process = this.emulatorProcess;
            this.monitorProcess(process);

            await this.connectWithRetries(port);
            const serverInfo = await getServerInfo(this.client);
            validateDebuggerServer(serverInfo);
            this.logger.info(`v6emul: ${serverInfo.emulatorVersion}, IPC protocol ${serverInfo.protocolVersion}`);

            const ping = await this.client.send<PingResponse>(IpcCommand.PING);
            if (!ping.ok) {
                throw new V6Error(ErrorCode.EMULATOR_LAUNCH_FAILED, 'PING health check failed');
            }
            await this.client.send(IpcCommand.DEBUG_ATTACH, { data: true });
            await this.client.send(IpcCommand.SET_COLOR_FORMAT, { colorFormat: 0 });
            await this.client.send(IpcCommand.STOP);
            this.setState('connected');
            return { client: this.client, process, port };
        } catch (err) {
            this.cleanup();
            this._owner = null;
            this.setState('stopped');
            throw err;
        }
    }

    setExecutionRunning(running: boolean): void {
        if (this.connected) {
            this.setState(running ? 'running' : 'connected');
        }
    }

    async stopFromDisplay(): Promise<void> {
        await this.stop();
    }

    async stop(): Promise<void> {
        if (this._state === 'stopped') {
            return;
        }

        this.logger.info('v6emul: stopping...');

        try {
            if (this.client.connected) {
                await this.client.send(IpcCommand.STOP).catch(() => {});
                await this.client.send(IpcCommand.EXIT).catch(() => {});
            }
        } catch {
            // Best-effort
        }

        // Wait briefly for process to exit
        if (this.emulatorProcess) {
            const race = Promise.race([
                this.emulatorProcess.spawnResult.exitPromise,
                new Promise<void>((resolve) => setTimeout(resolve, 2000)),
            ]);
            await race;
        }

        this.cleanup();
        this._owner = null;
        this.setState('stopped');
        this.logger.info('v6emul: stopped');
    }

    async restart(project: V6Project): Promise<void> {
        await this.stop();
        await this.start(project);
    }

    async setFrameMode(frameMode: EmulatorFrameMode): Promise<void> {
        const frameModeValue = frameMode === 'full' ? 0 : frameMode === 'border' ? 1 : 2;
        await this.client.send(IpcCommand.SET_FRAME_MODE, { frameMode: frameModeValue });
        this.updateFrameMode(frameMode);
    }

    private async connectWithRetries(port: number): Promise<void> {
        for (let attempt = 1; attempt <= CONNECT_MAX_RETRIES; attempt++) {
            try {
                await this.client.connect(port);
                return;
            } catch (err) {
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
            this._owner = null;
            this.setState('stopped');
            this.emit('exit', code);
        }).catch((err) => {
            if (this.emulatorProcess !== process) { return; }
            this.logger.error(`v6emul process error: ${err.message}`);
            this.emulatorProcess = null;
            this.client.disconnect();
            this._owner = null;
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
            case 'bordered':
                return { value: 1, panelMode: 'border' };
            default:
                return { value: 2, panelMode: 'borderless' };
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
