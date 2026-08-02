import * as vscode from 'vscode';
import {
    CMD_TOGGLE_DISPLAY,
    CMD_TOGGLE_HEX_VIEWER,
    CMD_TOGGLE_PORTS,
    CMD_TOGGLE_SETTINGS,
    CMD_TOGGLE_WATCHPOINTS,
} from '../../config/contribution-ids';

const PANELS = [
    { label: 'Settings', command: CMD_TOGGLE_SETTINGS, icon: 'settings-gear' },
    { label: 'Display', command: CMD_TOGGLE_DISPLAY, icon: 'vm' },
    { label: 'Hex Viewer', command: CMD_TOGGLE_HEX_VIEWER, icon: 'symbol-numeric' },
    { label: 'Ports', command: CMD_TOGGLE_PORTS, icon: 'symbol-field' },
    { label: 'Watchpoints', command: CMD_TOGGLE_WATCHPOINTS, icon: 'eye' },
] as const;

export class EmulatorPanelLauncherView implements vscode.TreeDataProvider<vscode.TreeItem> {
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    private readonly openCommands = new Set<string>();

    readonly onDidChangeTreeData = this.changeEmitter.event;

    setOpen(command: string, open: boolean): void {
        if (open) {
            this.openCommands.add(command);
        } else {
            this.openCommands.delete(command);
        }
        this.changeEmitter.fire();
    }

    getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
        return item;
    }

    getChildren(): vscode.TreeItem[] {
        return PANELS.map(panel => {
            const item = new vscode.TreeItem(panel.label, vscode.TreeItemCollapsibleState.None);
            const open = this.openCommands.has(panel.command);
            item.description = open ? 'Open' : '';
            item.iconPath = new vscode.ThemeIcon(open ? 'check' : panel.icon);
            item.command = { command: panel.command, title: panel.label };
            item.tooltip = `${open ? 'Close' : 'Open'} ${panel.label}`;
            return item;
        });
    }

    dispose(): void {
        this.changeEmitter.dispose();
    }
}