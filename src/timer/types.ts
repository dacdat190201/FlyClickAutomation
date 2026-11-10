/**
 * Timer Engine types. Pure TypeScript: no React, no native code. Lifecycle events from the
 * platform are fed in through `TimerEngine.notifyAppState` (see app-state-binding.ts).
 */

export type TimerState = 'IDLE' | 'WAITING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'STOPPED' | 'ERROR';

export type TimerRunContext = {
  /** 1-based number of this execution. */
  runIndex: number;
  /** When this run was scheduled (epoch ms, real clock). Compare with Date.now() to see lateness. */
  scheduledAt: number;
  /** Aborted on stop, on error, or when the run window ends. Actions should honour it. */
  signal: AbortSignal;
};

export type TimerAction = (context: TimerRunContext) => void | Promise<void>;

export type TimerConfig = {
  /** Wait before the schedule begins. Default 0. */
  startDelayMs: number;
  /**
   * Length of the run window, measured from the end of the start delay. Runs stop and the timer
   * completes when it ends. `null` = unlimited.
   */
  durationMs: number | null;
  /** Period between run starts (fixed rate, no drift). `null` = run exactly once. */
  intervalMs: number | null;
  /** Maximum number of scheduled runs. `null` = unlimited. */
  maxRepetitions: number | null;
  /** Move to ERROR when the action throws. When false the error is recorded and the schedule continues. Default true. */
  stopOnError: boolean;
  /**
   * What happens while the app is in the background (JavaScript cannot run there):
   * - `keep-clock`: wall-clock time keeps passing; on return the timer catches up per `missedRuns`.
   * - `pause`: the timer freezes in the background and resumes on return (time away does not count).
   */
  backgroundBehavior: 'keep-clock' | 'pause';
  /**
   * Runs that became overdue by at least `staleAfterMs` (while backgrounded, or because the
   * previous run overlapped):
   * - `skip`: drop them and wait for the next slot.
   * - `run-once`: run only the latest overdue slot, now.
   * Catching up every missed run is deliberately not offered: it could fire a burst of actions.
   */
  missedRuns: 'skip' | 'run-once';
  /** A run is stale when this late. Defaults to `intervalMs`; with a single run, never stale. */
  staleAfterMs: number | null;
};

export type TimerPhase = 'idle' | 'waiting' | 'running' | 'paused' | 'finished';

export type LastRun = {
  index: number;
  scheduledAt: number;
  startedAt: number;
  finishedAt: number | null;
  error: Error | null;
};

/** Everything a UI needs to show the countdown and status. Computed live from the clock. */
export type TimerSnapshot = {
  state: TimerState;
  phase: TimerPhase;
  /** Time until the schedule starts (while waiting) or until the next run. `null` if there is none. */
  countdownMs: number | null;
  /** Time left in the run window. `null` when unlimited or not applicable. */
  remainingMs: number | null;
  /** Active time since start (frozen while paused). */
  elapsedMs: number;
  runCount: number;
  maxRepetitions: number | null;
  /** Runs dropped because they were overdue or overlapped. */
  skippedRuns: number;
  executing: boolean;
  lastRun: LastRun | null;
  error: Error | null;
  inBackground: boolean;
  /** Estimated epoch time of the next run, or null (also null while paused). */
  nextRunAt: number | null;
};

export type TimerEventType =
  | 'state'
  | 'run-start'
  | 'run-end'
  | 'skipped'
  | 'lifecycle';

export type TimerEvent = { type: TimerEventType; snapshot: TimerSnapshot };
export type TimerListener = (event: TimerEvent) => void;

/** Clock and scheduling, injectable for tests. */
export type TimerEnv = {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};
