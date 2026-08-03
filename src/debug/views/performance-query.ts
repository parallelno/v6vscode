import { CodePerfSnapshot } from '../../emulator/protocol/debug-models';

export const MAX_PERFORMANCE_QUERY_LENGTH = 256;

export function normalizePerformanceQuery(value: string): string {
    return value.slice(0, MAX_PERFORMANCE_QUERY_LENGTH);
}

export function filterPerformanceEntries(
    entries: readonly CodePerfSnapshot[],
    query: string,
): readonly CodePerfSnapshot[] {
    const needle = normalizePerformanceQuery(query).trim().toLocaleLowerCase();
    return needle ? entries.filter(entry => entry.name.toLocaleLowerCase().includes(needle)) : entries;
}