import { EngineState } from './types';

/**
 * Pure state machine: no timers, no side effects. The engine asks it which transitions are legal.
 *
 * `complete` and `fail` are internal events raised by the run loop, not public commands.
 */
export type EngineEvent = 'start' | 'pause' | 'resume' | 'stop' | 'complete' | 'fail';

type TransitionTable = Record<EngineState, Partial<Record<EngineEvent, EngineState>>>;

const S = EngineState;

export const TRANSITIONS: TransitionTable = {
  [S.IDLE]: { start: S.RUNNING },
  [S.RUNNING]: { pause: S.PAUSED, stop: S.STOPPED, complete: S.COMPLETED, fail: S.ERROR },
  // `fail` is legal while PAUSED: a pause only takes effect after the in-flight task settles,
  // and that task may fail in the meantime.
  [S.PAUSED]: { resume: S.RUNNING, stop: S.STOPPED, fail: S.ERROR },
  // Terminal states can be restarted. Starting while RUNNING/PAUSED is rejected (no duplicate runs).
  [S.STOPPED]: { start: S.RUNNING },
  [S.COMPLETED]: { start: S.RUNNING },
  [S.ERROR]: { start: S.RUNNING },
};

/** Returns the next state, or `null` if the event is not allowed in `state`. */
export function nextState(state: EngineState, event: EngineEvent): EngineState | null {
  return TRANSITIONS[state][event] ?? null;
}

export function canTransition(state: EngineState, event: EngineEvent): boolean {
  return nextState(state, event) !== null;
}

export function isActive(state: EngineState): boolean {
  return state === S.RUNNING || state === S.PAUSED;
}

export function isTerminal(state: EngineState): boolean {
  return state === S.STOPPED || state === S.COMPLETED || state === S.ERROR;
}
