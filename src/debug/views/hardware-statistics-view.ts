import * as vscode from 'vscode';
import { EmulatorLifecycle } from '../../emulator/lifecycle/emulator-lifecycle';
import { IpcClient } from '../../emulator/client/ipc-client';
import { GetHardwareMainStatsResponse, GetRegsResponse, IpcCommand } from '../../emulator/protocol/ipc-commands';
import { CpuStatistics, formatCpuStatistics } from '../../emulator/panel/cpu-statistics-panel';
import { Logger } from '../../platform/logging/logger';

export const HARDWARE_STATISTICS_VIEW_ID = 'v6.hardwareStatistics';
export const CMD_REFRESH_HARDWARE_STATISTICS = 'v6.refreshHardwareStatistics';

export interface HardwareStatisticsNode {
    label: string;
    value?: string;
    children?: HardwareStatisticsNode[];
}

export function buildHardwareStatisticsNodes(statistics: CpuStatistics): HardwareStatisticsNode[] {
    return formatCpuStatistics(statistics).map(section => ({
        label: section.title,
        children: section.rows.map(([label, value]) => ({ label, value })),
    }));
}

export class HardwareStatisticsView implements vscode.TreeDataProvider<HardwareStatisticsNode>, vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<HardwareStatisticsNode | undefined>();
    readonly onDidChangeTreeData = this.changeEmitter.event;
    private nodes: HardwareStatisticsNode[] = [];
    private status = 'No active emulator session';
    private readonly stateListener: (state: string) => void;

    constructor(
        private readonly lifecycle: EmulatorLifecycle,
        private readonly client: IpcClient,
        private readonly logger: Logger,
    ) {
        this.stateListener = state => {
            if (state === 'connected') {
                void this.refresh();
            } else if (state === 'running') {
                this.status = 'Running; values refresh when paused';
                this.changeEmitter.fire(undefined);
            } else if (state === 'stopped') {
                this.nodes = [];
                this.status = 'No active emulator session';
                this.changeEmitter.fire(undefined);
            }
        };
        this.lifecycle.on('stateChange', this.stateListener);
    }

    getTreeItem(element: HardwareStatisticsNode): vscode.TreeItem {
        const collapsibleState = element.children
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;
        const item = new vscode.TreeItem(element.label, collapsibleState);
        item.description = element.value;
        item.tooltip = element.value ? `${element.label}: ${element.value}` : element.label;
        return item;
    }

    getChildren(element?: HardwareStatisticsNode): HardwareStatisticsNode[] {
        if (element) {
            return element.children ?? [];
        }
        return this.nodes.length > 0 ? this.nodes : [{ label: this.status }];
    }

    async refresh(): Promise<void> {
        if (!this.client.connected || this.lifecycle.running) {
            this.status = this.lifecycle.running
                ? 'Running; values refresh when paused'
                : 'No active emulator session';
            this.changeEmitter.fire(undefined);
            return;
        }

        try {
            const registers = await this.client.send<GetRegsResponse>(IpcCommand.GET_REGS, undefined, 5000, 'high');
            const hardware = await this.client.send<GetHardwareMainStatsResponse>(IpcCommand.GET_HW_MAIN_STATS, undefined, 5000, 'high');
            if (!registers.ok || !registers.data || !hardware.ok || !hardware.data) {
                throw new Error(registers.error ?? hardware.error ?? 'Statistics request failed');
            }
            this.nodes = buildHardwareStatisticsNodes({
                registers: registers.data,
                hardware: hardware.data,
            });
            this.status = '';
            this.changeEmitter.fire(undefined);
        } catch (err) {
            this.logger.error(`hardware-statistics: ${err instanceof Error ? err.message : String(err)}`);
            this.nodes = [];
            this.status = 'Statistics unavailable';
            this.changeEmitter.fire(undefined);
        }
    }

    dispose(): void {
        this.lifecycle.removeListener('stateChange', this.stateListener);
        this.changeEmitter.dispose();
    }
}