/** Structural logging port for core services; no VS Code runtime dependency. */
export interface LogSink {
    error(message: string): void;
    warn(message: string): void;
    info(message: string): void;
    debug(message: string): void;
}