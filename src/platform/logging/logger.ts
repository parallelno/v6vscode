import * as vscode from 'vscode';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
};

export class Logger implements vscode.Disposable {
    private readonly channel: vscode.OutputChannel;

    constructor(channelName: string = 'v6vscode') {
        this.channel = vscode.window.createOutputChannel(channelName);
    }

    private getConfiguredLevel(): LogLevel {
        return vscode.workspace.getConfiguration('v6').get<LogLevel>('logLevel', 'info');
    }

    private shouldLog(level: LogLevel): boolean {
        return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[this.getConfiguredLevel()];
    }

    private write(level: LogLevel, message: string): void {
        if (!this.shouldLog(level)) {
            return;
        }
        const timestamp = new Date().toISOString();
        this.channel.appendLine(`[${timestamp}] [${level.toUpperCase()}] ${message}`);
    }

    error(message: string): void {
        this.write('error', message);
    }

    warn(message: string): void {
        this.write('warn', message);
    }

    info(message: string): void {
        this.write('info', message);
    }

    debug(message: string): void {
        this.write('debug', message);
    }

    dispose(): void {
        this.channel.dispose();
    }
}
