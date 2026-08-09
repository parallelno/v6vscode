import { expect } from 'chai';
import { PassThrough } from 'stream';
import { buildArgs, LaunchRequest, V6emulLauncher } from '../../../src/emulator/launcher/v6emul-launcher';

describe('v6emul-launcher', () => {
    it('routes server stdout and stderr only to the server output channel by line', async () => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const processRunner = {
            spawn: () => ({
                process: { stdout, stderr },
                exitPromise: Promise.resolve(0),
            }),
        };
        const info: string[] = [];
        const output: string[] = [];
        const launcher = new V6emulLauncher(processRunner as any, {
            info: (message: string) => info.push(message),
        } as any, { appendLine: (line: string) => output.push(line) });

        launcher.launch({ emulatorPath: '/path/to/v6emul', tcpPort: 9876 });
        stdout.end('PC is 0x0128\nsecond line\n');
        stderr.end('script warning\n');
        await new Promise(resolve => setImmediate(resolve));

        expect(output).to.deep.equal(['PC is 0x0128', 'second line', '[stderr] script warning']);
        expect(info).to.have.length(1);
        expect(info[0]).to.contain('v6emul-launcher: launching');
    });

    describe('buildArgs', () => {
        it('should always include --serve and --tcp-port', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                tcpPort: 9876,
            };
            const args = buildArgs(request);
            expect(args).to.include('--serve');
            expect(args).to.include('--tcp-port');
            expect(args).to.include('9876');
        });

        it('should include --boot-rom when bootRomPath is set', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                bootRomPath: '/path/to/boot.bin',
                tcpPort: 9876,
            };
            const args = buildArgs(request);
            expect(args).to.include('--boot-rom');
            expect(args).to.include('/path/to/boot.bin');
        });

        it('should include --rom and --load-addr for ROM loading', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                romPath: '/path/to/game.rom',
                loadAddr: '0x100',
                tcpPort: 9876,
            };
            const args = buildArgs(request);
            expect(args).to.include('--rom');
            expect(args).to.include('/path/to/game.rom');
            expect(args).to.include('--load-addr');
            expect(args).to.include('0x100');
        });

        it('should not include --load-addr when romPath is absent', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                loadAddr: '0x100',
                tcpPort: 9876,
            };
            const args = buildArgs(request);
            expect(args).to.not.include('--load-addr');
        });

        it('should include --fdd and --fdd-autoboot for floppy loading', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                fddPath: '/path/to/game.fdd',
                fddAutoboot: true,
                tcpPort: 9876,
            };
            const args = buildArgs(request);
            expect(args).to.include('--fdd');
            expect(args).to.include('/path/to/game.fdd');
            expect(args).to.include('--fdd-autoboot');
        });

        it('should include --fdd-drive when specified', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                fddPath: '/path/to/game.fdd',
                fddDrive: 1,
                tcpPort: 9876,
            };
            const args = buildArgs(request);
            expect(args).to.include('--fdd-drive');
            expect(args).to.include('1');
        });

        it('should not include --fdd-drive when fddPath is absent', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                fddDrive: 1,
                tcpPort: 9876,
            };
            const args = buildArgs(request);
            expect(args).to.not.include('--fdd-drive');
        });

        it('should include --speed for known speed values', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                speed: 'max',
                tcpPort: 9876,
            };
            const args = buildArgs(request);
            expect(args).to.include('--speed');
            expect(args).to.include('max');
        });

        it('should not include --speed for unknown speed values', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                speed: 'turbo',
                tcpPort: 9876,
            };
            const args = buildArgs(request);
            expect(args).to.not.include('--speed');
        });

        it('should include all options for a full request', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                romPath: '/path/to/game.rom',
                loadAddr: '0x200',
                bootRomPath: '/path/to/boot.bin',
                speed: '200%',
                tcpPort: 12345,
            };
            const args = buildArgs(request);
            expect(args).to.include('--serve');
            expect(args).to.include('--tcp-port');
            expect(args).to.include('12345');
            expect(args).to.include('--boot-rom');
            expect(args).to.include('/path/to/boot.bin');
            expect(args).to.include('--rom');
            expect(args).to.include('/path/to/game.rom');
            expect(args).to.include('--load-addr');
            expect(args).to.include('0x200');
            expect(args).to.include('--speed');
            expect(args).to.include('200%');
        });

        it('should use custom tcp port', () => {
            const request: LaunchRequest = {
                emulatorPath: '/path/to/v6emul',
                tcpPort: 55555,
            };
            const args = buildArgs(request);
            const portIdx = args.indexOf('--tcp-port');
            expect(portIdx).to.be.greaterThan(-1);
            expect(args[portIdx + 1]).to.equal('55555');
        });
    });
});
