import type {
  LastRun,
  TimerAction,
  TimerConfig,
  TimerEnv,
  TimerEvent,
  TimerEventType,
  TimerListener,
  TimerPhase,
  TimerSnapshot,
  TimerState,
} from './types';

export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  startDelayMs: 0,
  durationMs: null,
  intervalMs: null,
  maxRepetitions: null,
  stopOnError: true,
  backgroundBehavior: 'keep-clock',
  missedRuns: 'skip',
  staleAfterMs: null,
};

/** setTimeout stores its delay in a signed 32-bit int; longer waits are re-armed. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const defaultEnv: TimerEnv = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const toError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

function validate(c: TimerConfig) {
  const fail = (m: string): never => {
    throw new RangeError(m);
  };
  if (!Number.isFinite(c.startDelayMs) || c.startDelayMs < 0) fail('startDelayMs must be >= 0');
  if (c.durationMs !== null && (!Number.isFinite(c.durationMs) || c.durationMs <= 0)) {
    fail('durationMs must be > 0 or null');
  }
  if (c.intervalMs !== null && (!Number.isFinite(c.intervalMs) || c.intervalMs <= 0)) {
    fail('intervalMs must be > 0 or null');
  }
  if (c.maxRepetitions !== null && (!Number.isInteger(c.maxRepetitions) || c.maxRepetitions < 1)) {
    fail('maxRepetitions must be an integer >= 1 or null');
  }
  if (c.intervalMs === null && c.maxRepetitions !== null && c.maxRepetitions > 1) {
    fail('maxRepetitions > 1 needs an intervalMs');
  }
  if (c.staleAfterMs !== null && (!Number.isFinite(c.staleAfterMs) || c.staleAfterMs <= 0)) {
    fail('staleAfterMs must be > 0 or null');
  }
}

/**
 * Starts after a delay, then runs an action once or repeatedly, for a limited or unlimited time.
 *
 * Time is derived from the clock, never counted from timer ticks: `setTimeout` only wakes the
 * engine up, and every wake-up recomputes what is due. That is what keeps it correct when the
 * JS thread is late or the app was in the background. Pausing freezes a *virtual* clock, so a
 * pause shifts the whole schedule without any bookkeeping per timestamp.
 *
 * Runs never overlap: a new run waits for the previous action to settle.
 */
export class TimerEngine {
  private readonly action: TimerAction;
  private readonly config: TimerConfig;
  private readonly env: TimerEnv;
  private readonly listeners = new Set<TimerListener>();

  private state: TimerState = 'IDLE';
  private resumeTo: 'WAITING' | 'RUNNING' = 'WAITING';

  // Virtual clock: real time minus time spent paused.
  private pausedTotal = 0;
  private pausedAt: number | null = null;

  private startV = 0;
  private scheduleStartV = 0;
  private nextSlot = 0;
  private queue: number[] = [];

  private runCount = 0;
  private skippedRuns = 0;
  private lastRun: LastRun | null = null;
  private error: Error | null = null;

  private executing = false;
  private abort: AbortController | null = null;
  private settled: Promise<void> | null = null;
  private timer: unknown = null;

  private inBackground = false;
  private autoPaused = false;
  /** Virtual time at which the app went to the background; consumed by the first catch-up. */
  private awayFromV: number | null = null;

  constructor(action: TimerAction, config: Partial<TimerConfig> = {}, env: TimerEnv = defaultEnv) {
    this.action = action;
    this.config = { ...DEFAULT_TIMER_CONFIG, ...config };
    this.env = env;
    validate(this.config);
  }

  // ---- Public API --------------------------------------------------------------------------

  getState(): TimerState {
    return this.state;
  }

  subscribe(listener: TimerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Begins the countdown. Returns false while a run is active or the last action is still settling. */
  start(): boolean {
    if (this.executing || this.state === 'WAITING' || this.state === 'RUNNING' || this.state === 'PAUSED') {
      return false;
    }
    this.pausedTotal = 0;
    this.pausedAt = null;
    this.autoPaused = false;
    this.nextSlot = 0;
    this.queue = [];
    this.runCount = 0;
    this.skippedRuns = 0;
    this.lastRun = null;
    this.error = null;
    this.abort = new AbortController();
    this.startV = this.env.now();
    this.scheduleStartV = this.startV + this.config.startDelayMs;

    this.setState('WAITING');
    this.arm(0); // never run the action synchronously inside start()
    return true;
  }

  pause(): boolean {
    if (this.state !== 'WAITING' && this.state !== 'RUNNING') return false;
    this.resumeTo = this.state;
    this.pausedAt = this.env.now();
    this.clearTimer();
    this.setState('PAUSED');
    return true;
  }

  resume(): boolean {
    if (this.state !== 'PAUSED' || this.pausedAt === null) return false;
    this.pausedTotal += this.env.now() - this.pausedAt;
    this.pausedAt = null;
    this.autoPaused = false;
    this.setState(this.resumeTo);
    this.arm(0);
    return true;
  }

  stop(): boolean {
    if (this.state !== 'WAITING' && this.state !== 'RUNNING' && this.state !== 'PAUSED') return false;
    this.abort?.abort();
    this.finish('STOPPED');
    return true;
  }

  /** Resolves once no action is executing any more. */
  async whenIdle(): Promise<void> {
    await this.settled;
  }

  /**
   * Feed the platform's app state here ('active' | 'inactive' | 'background', as in React
   * Native's AppState). Only 'background' counts as leaving: 'inactive' is a brief transition.
   */
  notifyAppState(status: string): void {
    const background = status === 'background';
    if (background === this.inBackground) return;
    this.inBackground = background;

    if (background) {
      // Only meaningful when wall-clock time keeps passing; in `pause` mode nothing is missed.
      const clockKeepsRunning =
        this.config.backgroundBehavior === 'keep-clock' && (this.state === 'WAITING' || this.state === 'RUNNING');
      this.awayFromV = clockKeepsRunning ? this.virtualNow() : null;
      this.clearTimer(); // a JS timer cannot be trusted while backgrounded
      if (this.config.backgroundBehavior === 'pause' && (this.state === 'WAITING' || this.state === 'RUNNING')) {
        this.autoPaused = true;
        this.pause();
      }
    } else if (this.autoPaused) {
      this.autoPaused = false;
      this.resume();
    } else {
      this.arm(0); // catch up: recompute what is due now
    }
    this.emit('lifecycle');
  }

  /** Live snapshot for displaying the countdown and status. Cheap; call it as often as you like. */
  getSnapshot(): TimerSnapshot {
    const v = this.virtualNow();
    const active = this.state === 'WAITING' || this.state === 'RUNNING' || this.state === 'PAUSED';
    const waiting = this.state === 'WAITING' || (this.state === 'PAUSED' && this.resumeTo === 'WAITING');

    let countdownMs: number | null = null;
    if (active) {
      if (waiting) countdownMs = Math.max(0, this.scheduleStartV - v);
      else if (this.slotValid(this.nextSlot)) countdownMs = Math.max(0, this.slotTime(this.nextSlot) - v);
    }

    let remainingMs: number | null = null;
    if (this.config.durationMs !== null && active) {
      remainingMs = waiting ? this.config.durationMs : Math.max(0, this.windowEnd() - v);
    }

    const phase: TimerPhase =
      this.state === 'IDLE'
        ? 'idle'
        : this.state === 'WAITING'
          ? 'waiting'
          : this.state === 'RUNNING'
            ? 'running'
            : this.state === 'PAUSED'
              ? 'paused'
              : 'finished';

    return {
      state: this.state,
      phase,
      countdownMs,
      remainingMs,
      elapsedMs: this.state === 'IDLE' ? 0 : Math.max(0, v - this.startV),
      runCount: this.runCount,
      maxRepetitions: this.config.maxRepetitions,
      skippedRuns: this.skippedRuns,
      executing: this.executing,
      lastRun: this.lastRun,
      error: this.error,
      inBackground: this.inBackground,
      nextRunAt: countdownMs !== null && this.state !== 'PAUSED' ? this.env.now() + countdownMs : null,
    };
  }

  // ---- Schedule ----------------------------------------------------------------------------

  private virtualNow(): number {
    return (this.pausedAt ?? this.env.now()) - this.pausedTotal;
  }

  private slotTime(i: number): number {
    return this.scheduleStartV + i * (this.config.intervalMs ?? 0);
  }

  private windowEnd(): number {
    return this.config.durationMs === null ? Infinity : this.scheduleStartV + this.config.durationMs;
  }

  private slotCount(): number {
    if (this.config.intervalMs === null) return 1;
    return this.config.maxRepetitions ?? Infinity;
  }

  private slotValid(i: number): boolean {
    return i < this.slotCount() && this.slotTime(i) < this.windowEnd();
  }

  private staleAfter(): number {
    return this.config.staleAfterMs ?? this.config.intervalMs ?? Infinity;
  }

  /** Recomputes what is due and acts on it. Every wake-up (timer, resume, foreground) ends up here. */
  private reconcile(): void {
    if (this.state !== 'WAITING' && this.state !== 'RUNNING') return;
    if (this.inBackground) return; // no actions while backgrounded; foregrounding re-runs this

    for (;;) {
      const v = this.virtualNow();

      if (this.state === 'WAITING') {
        if (v < this.scheduleStartV) return this.arm(this.scheduleStartV - v);
        this.setState('RUNNING');
      }

      if (v >= this.windowEnd()) {
        if (this.executing) this.abort?.abort(); // let the action wind down; completes once it settles
        else this.finish('COMPLETED');
        return;
      }

      if (this.executing) {
        // Wake up when the window ends so a long action can be aborted.
        const end = this.windowEnd();
        if (Number.isFinite(end)) this.arm(end - v);
        return;
      }

      if (this.queue.length > 0) {
        this.execute(this.queue.shift()!);
        return;
      }

      const due: number[] = [];
      let i = this.nextSlot;
      while (this.slotValid(i) && this.slotTime(i) <= v) due.push(i++);

      if (due.length === 0) {
        if (!this.slotValid(this.nextSlot)) {
          this.finish('COMPLETED');
          return;
        }
        return this.arm(Math.min(this.slotTime(this.nextSlot), this.windowEnd()) - v);
      }

      // A periodic run that fell due while the app was away counts as missed, however little
      // it is overdue: the user was not there for it. A one-off start is never dropped.
      const awayFrom = this.awayFromV;
      this.awayFromV = null;
      const periodic = this.config.intervalMs !== null;
      const stale = due.filter(
        (s) =>
          v - this.slotTime(s) >= this.staleAfter() ||
          (periodic && awayFrom !== null && this.slotTime(s) >= awayFrom),
      );
      const fresh = due.filter((s) => !stale.includes(s));
      const toRun = [...fresh];
      // `run-once` is "at most one run now": a fresh slot already is that run.
      if (this.config.missedRuns === 'run-once' && stale.length > 0 && fresh.length === 0) {
        toRun.push(stale[stale.length - 1]);
      }

      this.nextSlot = i;
      const skipped = due.length - toRun.length;
      if (skipped > 0) {
        this.skippedRuns += skipped;
        this.emit('skipped');
      }
      if (toRun.length === 0) continue; // all dropped: look at the next slots
      this.queue = toRun.slice(1);
      this.execute(toRun[0]);
      return;
    }
  }

  private execute(slot: number): void {
    const abort = this.abort!;
    this.executing = true;
    this.runCount++;
    const run: LastRun = {
      index: this.runCount,
      scheduledAt: this.env.now() - (this.virtualNow() - this.slotTime(slot)),
      startedAt: this.env.now(),
      finishedAt: null,
      error: null,
    };
    this.lastRun = run;
    this.emit('run-start');

    const end = this.windowEnd();
    if (Number.isFinite(end)) this.arm(end - this.virtualNow()); // abort long actions at the window end

    this.settled = (async () => {
      let failure: Error | null = null;
      try {
        await this.action({ runIndex: run.index, scheduledAt: run.scheduledAt, signal: abort.signal });
      } catch (e) {
        failure = toError(e);
      }
      this.executing = false;
      run.finishedAt = this.env.now();
      run.error = failure;
      this.emit('run-end');

      const live = this.state === 'WAITING' || this.state === 'RUNNING' || this.state === 'PAUSED';
      if (failure && this.config.stopOnError && live) {
        this.error = failure;
        abort.abort();
        this.finish('ERROR');
      } else if (this.state === 'RUNNING') {
        this.reconcile();
      }
      // PAUSED: resume() re-arms. Terminal: nothing to do.
    })();
  }

  // ---- Plumbing ----------------------------------------------------------------------------

  /** Arms the single wake-up timer, replacing any pending one. */
  private arm(delayMs: number): void {
    this.clearTimer();
    const wait = Math.min(MAX_TIMEOUT_MS, Math.max(0, delayMs));
    this.timer = this.env.setTimeout(() => {
      this.timer = null;
      this.reconcile();
    }, wait);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.env.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private finish(final: 'COMPLETED' | 'STOPPED' | 'ERROR'): void {
    this.clearTimer();
    this.queue = [];
    this.autoPaused = false;
    this.pausedAt = null;
    this.setState(final);
  }

  private setState(next: TimerState): void {
    this.state = next;
    this.emit('state');
  }

  private emit(type: TimerEventType): void {
    if (this.listeners.size === 0) return;
    const event: TimerEvent = { type, snapshot: this.getSnapshot() };
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A faulty listener must not break the timer.
      }
    }
  }
}
