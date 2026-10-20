/** VS Code's isolated browser API; no extension-host or Node globals. */
declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};