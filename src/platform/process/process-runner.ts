import { ChildProcess, spawn, SpawnOptionsWithoutStdio } from 'child_process';

export interface SpawnResult {
    process: ChildProcess;
    exitPromise: Promise<number | null>;
}

export class ProcessRunner {
    spawn(executable: string, args: string[], options?: SpawnOptionsWithoutStdio): SpawnResult {
        const proc = spawn(executable, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            ...options,
        });

        const exitPromise = new Promise<number | null>((resolve, reject) => {
            proc.on('exit', (code) => resolve(code));
            proc.on('error', (err) => reject(err));
        });

        return { process: proc, exitPromise };
    }
}
