/** The transport owns deadlines; callers can supply deterministic scheduling. */
export interface TimerClock {
    schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
    cancel(timer: ReturnType<typeof setTimeout> | undefined): void;
}

export const systemTimerClock: TimerClock = {
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: timer => clearTimeout(timer),
};
