export const MEMORY_BANK_SIZE = 0x10000;
export const RAM_DISK_COUNT = 8;
export const RAM_DISK_BANK_COUNT = 4;

export type MemorySpace =
    | { kind: 'main' }
    | { kind: 'ramDisk'; disk: number; bank: number };

export const MAIN_MEMORY_SPACE: MemorySpace = { kind: 'main' };

export function memorySpaceKey(space: MemorySpace): string {
    return space.kind === 'main' ? 'main' : `ramDisk:${space.disk}:${space.bank}`;
}

export function memorySpaceLabel(space: MemorySpace): string {
    return space.kind === 'main' ? 'Main RAM' : `RAM Disk ${space.disk} / Bank ${space.bank}`;
}

export function isValidMemorySpace(space: MemorySpace): boolean {
    return space.kind === 'main'
        || (Number.isInteger(space.disk)
            && space.disk >= 1
            && space.disk <= RAM_DISK_COUNT
            && Number.isInteger(space.bank)
            && space.bank >= 0
            && space.bank < RAM_DISK_BANK_COUNT);
}

export function allMemorySpaces(
    diskCount = RAM_DISK_COUNT,
    banksPerDisk = RAM_DISK_BANK_COUNT,
): MemorySpace[] {
    const spaces: MemorySpace[] = [MAIN_MEMORY_SPACE];
    for (let disk = 1; disk <= Math.min(diskCount, RAM_DISK_COUNT); disk++) {
        for (let bank = 0; bank < Math.min(banksPerDisk, RAM_DISK_BANK_COUNT); bank++) {
            spaces.push({ kind: 'ramDisk', disk, bank });
        }
    }
    return spaces;
}

export function memorySpaceGlobalAddress(space: MemorySpace, offset: number): number {
    const spaceIndex = space.kind === 'main'
        ? 0
        : 1 + (space.disk - 1) * RAM_DISK_BANK_COUNT + space.bank;
    return spaceIndex * MEMORY_BANK_SIZE + offset;
}