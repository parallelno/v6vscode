/** Presentation-only ports; debugger policies never depend on concrete panels. */
export interface DebugDisplay { reveal(): void }
export interface WatchpointFeedback { showStop(ids: readonly number[], address?: number): void }