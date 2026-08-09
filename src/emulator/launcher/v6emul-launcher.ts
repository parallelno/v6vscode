import * as readline from 'readline';
import { ProcessRunner, SpawnResult } from '../../platform/process/process-runner';
import { Logger } from '../../platform/logging/logger';

interface ServerOutput {
    appendLine(value: string): void;
}

export interface LaunchRequest {
    emulatorPath: string;
    romPath?: string;
    loadAddr?: string;
    bootRomPath?: string;
    fddPath?: string;
    fddDrive?: number;
    fddAutoboot?: boolean;
    speed?: string;
    tcpPort: number;
}

export interface EmulatorProcess {
    spawnResult: SpawnResult;
    port: number;
}

const SPEED_MAP: Record<string, string> = {
    '1%': '1%',
    '20%': '20%',
    '50%': '50%',
    '100%': '100%',
    '200%': '200%',
    'max': 'max',
};

export function buildArgs(request: LaunchRequest): string[] {
    const args: string[] = ['--serve', '--tcp-port', String(request.tcpPort)];

    if (request.bootRomPath) {
        args.push('--boot-rom', request.bootRomPath);
    }

    if (request.romPath) {
        args.push('--rom', request.romPath);
        if (request.loadAddr) {
            args.push('--load-addr', request.loadAddr);
        }
    }

    if (request.fddPath) {
        args.push('--fdd', request.fddPath);
        if (request.fddDrive !== undefined) {
            args.push('--fdd-drive', String(request.fddDrive));
        }
        if (request.fddAutoboot) {
            args.push('--fdd-autoboot');
        }
    }

    if (request.speed && SPEED_MAP[request.speed]) {
        args.push('--speed', SPEED_MAP[request.speed]);
    }

    return args;
}

export class V6emulLauncher {
    private readonly processRunner: ProcessRunner;
    private readonly logger: Logger;

    constructor(
        processRunner: ProcessRunner,
        logger: Logger,
        private readonly serverOutput: ServerOutput,
    ) {
        this.processRunner = processRunner;
        this.logger = logger;
    }

    launch(request: LaunchRequest): EmulatorProcess {
        const args = buildArgs(request);

        this.logger.info(`v6emul-launcher: launching "${request.emulatorPath}" ${args.join(' ')}`);

        const spawnResult = this.processRunner.spawn(request.emulatorPath, args);
        this.routeServerOutput(spawnResult);

        return { spawnResult, port: request.tcpPort };
    }

    private routeServerOutput(spawnResult: SpawnResult): void {
        if (spawnResult.process.stdout) {
            readline.createInterface({ input: spawnResult.process.stdout })
                .on('line', line => this.serverOutput.appendLine(line));
        }
        if (spawnResult.process.stderr) {
            readline.createInterface({ input: spawnResult.process.stderr })
                .on('line', line => this.serverOutput.appendLine(`[stderr] ${line}`));
        }
    }

    async getVersion(emulatorPath: string): Promise<string> {
        const result = this.processRunner.spawn(emulatorPath, ['--version']);
        let stdout = '';
        result.process.stdout?.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        const code = await result.exitPromise;
        if (code !== 0) {
            throw new Error(`v6emul --version exited with code ${code}`);
        }
        return stdout.trim();
    }
}
