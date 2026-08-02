import * as vscode from 'vscode';
import { V6Error } from './v6-error';
import { ErrorCode } from './error-codes';
import { Logger } from '../logging/logger';

interface ErrorAction {
    label: string;
    action: () => void;
}

function getActions(code: ErrorCode): ErrorAction[] {
    switch (code) {
        case ErrorCode.EMULATOR_NOT_FOUND:
            return [];
        case ErrorCode.EXECUTABLE_NOT_FOUND:
            return [
                {
                    label: 'Open Terminal',
                    action: () => vscode.commands.executeCommand(
                        'workbench.action.terminal.toggleTerminal',
                    ),
                },
            ];
        case ErrorCode.CONFIG_INVALID:
            return [];
        case ErrorCode.EMULATOR_LAUNCH_FAILED:
        case ErrorCode.IPC_CONNECTION_REFUSED:
        case ErrorCode.IPC_TIMEOUT:
        case ErrorCode.IPC_DECODE_ERROR:
            return [
                {
                    label: 'Show Output',
                    action: () => vscode.commands.executeCommand(
                        'workbench.action.output.toggleOutput',
                    ),
                },
            ];
        default:
            return [];
    }
}

const USER_MESSAGES: Record<string, string> = {
    [ErrorCode.CONFIG_INVALID]: 'Project configuration is invalid.',
    [ErrorCode.EMULATOR_NOT_FOUND]: 'Emulator not found. Set V6EMUL to the full path of the v6emul executable and restart VS Code.',
    [ErrorCode.EXECUTABLE_NOT_FOUND]: 'Executable not found. Build the project first (e.g. `make`).',
    [ErrorCode.EMULATOR_LAUNCH_FAILED]: 'Failed to launch the emulator.',
    [ErrorCode.IPC_CONNECTION_REFUSED]: 'Could not connect to the emulator.',
    [ErrorCode.IPC_TIMEOUT]: 'Emulator communication timed out.',
    [ErrorCode.IPC_DECODE_ERROR]: 'Received a malformed response from the emulator.',
};

/**
 * Show a V6Error to the user as a VS Code notification with contextual actions.
 */
export async function showV6Error(err: V6Error, logger: Logger): Promise<void> {
    const friendlyMessage = USER_MESSAGES[err.code] || err.message;
    const fullMessage = `V6: ${friendlyMessage}`;
    logger.error(`${err.code}: ${err.message}`);

    const actions = getActions(err.code);
    if (actions.length === 0) {
        vscode.window.showErrorMessage(fullMessage);
        return;
    }

    const labels = actions.map(a => a.label);
    const choice = await vscode.window.showErrorMessage(fullMessage, ...labels);
    if (choice) {
        const selected = actions.find(a => a.label === choice);
        selected?.action();
    }
}
