/** Metadata paths accept both separators; drive names are not source suffixes. */
export function splitSourcePathSegments(value: string): string[] {
    return value.split(/[\\/]+/)
        .filter(segment => segment.length > 0 && !/^[A-Za-z]:$/.test(segment));
}