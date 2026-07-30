import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { GetHardwareMainStatsResponse, GetRegsResponse } from '../protocol/ipc-commands';

export interface CpuStatistics {
    registers: GetRegsResponse;
    hardware: GetHardwareMainStatsResponse;
}

export interface CpuStatisticsSection {
    title: string;
    rows: Array<[string, string]>;
}

export function formatCpuStatistics(statistics: CpuStatistics): CpuStatisticsSection[] {
    const { registers, hardware } = statistics;
    const flags: Array<[string, number]> = [
        ['S', 0x80], ['Z', 0x40], ['AC', 0x10], ['P', 0x04], ['CY', 0x01],
    ];

    return [
        {
            title: 'Registers',
            rows: [
                ['PC', toHex(registers.pc, 4)], ['SP', toHex(registers.sp, 4)],
                ['AF', toHex(registers.af, 4)], ['BC', toHex(registers.bc, 4)],
                ['DE', toHex(registers.de, 4)], ['HL', toHex(registers.hl, 4)],
                ['CC', toHex(registers.cc, 2)], ['Interrupts', String(registers.ints)],
                ['Memory at HL', toHex(registers.m, 2)],
            ],
        },
        {
            title: 'Flags',
            rows: flags.map(([name, mask]) => [name, (registers.cc & mask) !== 0 ? 'Set' : 'Clear']),
        },
        {
            title: 'Execution',
            rows: [
                ['CPU cycles', String(hardware.cc)], ['Frame', String(hardware.frameNum)],
                ['Frame cycles', String(hardware.frameCc)], ['Speed', `${hardware.speedPercent.toFixed(1)}%`],
                ['Interrupt enabled', hardware.inte ? 'Yes' : 'No'], ['Interrupt flip-flop', hardware.iff ? 'Set' : 'Clear'],
                ['Halted', hardware.hlta ? 'Yes' : 'No'],
            ],
        },
        {
            title: 'Display',
            rows: [
                ['Raster line', String(hardware.rasterLine)], ['Raster pixel', String(hardware.rasterPixel)],
                ['Mode', String(hardware.displayMode)], ['Vertical scroll', String(hardware.scrollVert)],
                ['RusLat', hardware.rusLat ? 'Active' : 'Inactive'],
            ],
        },
    ];
}

export class CpuStatisticsPanel implements vscode.Disposable {
    private panel: vscode.WebviewPanel | undefined;

    show(statistics: CpuStatistics): void {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                'v6emulCpuStatistics',
                'v6emul: CPU Statistics',
                vscode.ViewColumn.Beside,
                { enableScripts: false, retainContextWhenHidden: true },
            );
            this.panel.onDidDispose(() => {
                this.panel = undefined;
            });
        } else {
            this.panel.reveal(vscode.ViewColumn.Beside);
        }

        this.panel.webview.html = this.getHtml(this.panel.webview, statistics);
    }

    dispose(): void {
        this.panel?.dispose();
        this.panel = undefined;
    }

    private getHtml(webview: vscode.Webview, statistics: CpuStatistics): string {
        const nonce = crypto.randomBytes(16).toString('hex');
        const sections = formatCpuStatistics(statistics);

        return [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '<head>',
            '    <meta charset="UTF-8">',
            `    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'">`,
            '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
            `    <style nonce="${nonce}">`,
            '        body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-editor-font-family); font-size: 12px; margin: 8px; }',
            '        main { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px; max-width: 620px; }',
            '        section { border: 1px solid var(--vscode-panel-border); padding: 6px 8px; }',
            '        h2 { font-family: var(--vscode-font-family); font-size: 12px; margin: 0 0 4px; }',
            '        table { border-collapse: collapse; width: 100%; }',
            '        th, td { border-bottom: 1px solid var(--vscode-panel-border); padding: 2px 0; text-align: left; }',
            '        th { color: var(--vscode-descriptionForeground); font-weight: normal; }',
            '        td { text-align: right; }',
            '    </style>',
            '    <title>CPU Statistics</title>',
            '</head>',
            '<body>',
            '    <main>',
            ...sections.map((section) => `        ${this.table(section.title, section.rows)}`),
            '    </main>',
            '</body>',
            '</html>',
        ].join('\n');
    }

    private table(title: string, rows: ReadonlyArray<readonly [string, string]>): string {
        return `<section><h2>${title}</h2><table>${rows.map(([label, value]) => this.row(label, value)).join('')}</table></section>`;
    }

    private row(label: string, value: string): string {
        return `<tr><th>${label}</th><td>${value}</td></tr>`;
    }

}

function toHex(value: number, width: number): string {
    return `0x${value.toString(16).toUpperCase().padStart(width, '0')}`;
}