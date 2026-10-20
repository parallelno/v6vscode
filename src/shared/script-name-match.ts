export const MAX_SCRIPTS_QUERY_LENGTH = 256;

export function matchesScriptName(name: string, query: string): boolean {
    const normalized = query.trim().slice(0, MAX_SCRIPTS_QUERY_LENGTH).toLocaleLowerCase();
    if (!normalized) { return true; }
    const candidate = name.toLocaleLowerCase();
    if (!normalized.includes('*')) { return candidate.includes(normalized); }
    const collapsed = normalized.replace(/\*+/g, '*');
    const expression = collapsed
        .split('*')
        .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${expression}$`, 'u').test(candidate);
}
