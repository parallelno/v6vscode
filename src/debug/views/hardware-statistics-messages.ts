import { HardwareStatisticsRow, RamDiskDisplay } from '../hardware-statistics/hardware-statistics-format';

export interface HardwareStatisticsViewModel {
    generation: number;
    rows: readonly HardwareStatisticsRow[];
    palette: ReadonlyArray<{ index: number; hwColor: number; rgb: string; tooltip: string }>;
    ramDisk: RamDiskDisplay;
    selectedDrive: string;
    drives: ReadonlyArray<{ index: number; label: string; mounted: boolean; path: string; updated: boolean }>;
}

export type HardwareStatisticsWebviewMessage =
    | { type: 'ready' }
    | { type: 'refresh'; generation: number }
    | { type: 'copyPalette'; generation: number; index: number }
    | { type: 'pastePalette'; generation: number; index: number }
    | { type: 'editPalette'; generation: number; index: number; value: string }
    | { type: 'mountDrive'; generation: number; driveIdx: number }
    | { type: 'dismountDrive'; generation: number; driveIdx: number };

export type HardwareStatisticsHostMessage =
    | { type: 'state'; state: 'noSession' | 'unsupported' | 'loading' | 'ready' | 'running' | 'error'; message: string; canMutate: boolean }
    | { type: 'snapshot'; model: HardwareStatisticsViewModel }
    | { type: 'reset'; generation: number }
    | { type: 'operation'; ok: boolean; message: string };