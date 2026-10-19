/** Compatibility facade: session ownership now lives in the coordinator. */
export { SessionCoordinator as EmulatorLifecycle } from '../session/session-coordinator';
export type {
    DebugLaunchRequest, EmulatorState, EmulatorFrameMode, EmulatorSessionOwner,
    SessionProgram, StopContext, StopParticipant,
} from '../session/session-coordinator';
