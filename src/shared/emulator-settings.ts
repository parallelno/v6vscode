export const SPEED_VALUES: Readonly<Record<string, number>> = Object.freeze({
    '1%': 0, '20%': 1, '50%': 2, '100%': 3, '200%': 4, max: 5,
});
export const VIEW_MODES = ['borderless', 'border', 'full'] as const;
export type ViewMode = typeof VIEW_MODES[number];
export const DEFAULT_RUN_SETTINGS = Object.freeze({ loadAddr: '0x100', speed: '100%', viewMode: 'borderless' as ViewMode, fddReadOnly: false });
export const LOAD_ADDRESS_PATTERN = '^(?:0[xX])?[0-9a-fA-F]{1,4}$';

/** Project load addresses are hex even without 0x; never parse a prefix and ignore junk. */
export function loadAddress(value: string = DEFAULT_RUN_SETTINGS.loadAddr): number {
    if (!new RegExp(LOAD_ADDRESS_PATTERN).test(value)) { throw new RangeError('Load address must be a complete 16-bit hexadecimal address'); }
    return Number.parseInt(value.replace(/^0x/i, ''), 16);
}
export function frameMode(viewMode: string | undefined): { value: number; panelMode: ViewMode } {
    return viewMode === 'full' ? { value: 0, panelMode: 'full' }
        : viewMode === 'border' ? { value: 1, panelMode: 'border' } : { value: 2, panelMode: 'borderless' };
}