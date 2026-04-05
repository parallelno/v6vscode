import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import { SpawnResult } from '../../src/platform/process/process-runner';

/**
 * Stub ProcessRunner for unit tests.
 * Returns a controllable fake ChildProcess.
 */
export class MockProcessRunner {
    lastArgs: string[] = [];
    lastExecutable = '';
    private fakeProcess: FakeChildProcess | null = null;
    private resolveExit: ((code: number | null) => void) | null = null;

    spawn(executable: string, args: string[]): SpawnResult {
        this.lastExecutable = executable;
        this.lastArgs = args;
        this.fakeProcess = new FakeChildProcess();

        const exitPromise = new Promise<number | null>((resolve) => {
            this.resolveExit = resolve;
        });

        return {
            process: this.fakeProcess as unknown as ChildProcess,
            exitPromise,
        };
    }

    /** Simulate the process exiting. */
    simulateExit(code: number | null): void {
        if (this.resolveExit) {
            this.resolveExit(code);
        }
        if (this.fakeProcess) {
            this.fakeProcess.emit('exit', code);
        }
    }

    getProcess(): FakeChildProcess | null {
        return this.fakeProcess;
    }
}

class FakeChildProcess extends EventEmitter {
    pid = 12345;
    killed = false;

    kill(): boolean {
        this.killed = true;
        return true;
    }
}
