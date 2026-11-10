import { nextState, type EngineEvent } from './state-machine';
import {
  EngineState,
  type AutomationAdapter,
  type AutomationTask,
  type EngineConfig,
  type EngineListener,
  type EngineSnapshot,
} from './types';

const DEFAULT_CONFIG: EngineConfig = { defaultDelayMs: 0, maxRetries: 0, retryDelayMs: 0 };

function assertNonNegativeInt(name: string, value: number) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}

function validateConfig(config: EngineConfig) {
  assertNonNegativeInt('defaultDelayMs', config.defaultDelayMs);
  assertNonNegativeInt('maxRetries', config.maxRetries);
  assertNonNegativeInt('retryDelayMs', config.retryDelayMs);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * Runs a list of tasks one after another through an adapter, under a small state machine.
 *
 * - Commands (`start`, `pause`, `resume`, `stop`) never throw. They return `true` if accepted
 *   and `false` if the command is not valid in the current state (e.g. `start` while RUNNING).
 * - `pause` takes effect at the next checkpoint: a task that is already executing is allowed
 *   to finish, and the next attempt will not begin until `resume`.
 * - `stop` aborts the signal given to the adapter and cancels pending delays.
 * - Adapter failures (sync throw or rejection) are caught, retried up to the limit, and then
 *   move the engine to ERROR. Listener exceptions are isolated and never break the run.
 */
export class AutomationEngine {
  private readonly adapter: AutomationAdapter;
  private readonly config: EngineConfig;
  private readonly listeners = new Set<EngineListener>();

  private state: EngineState = EngineState.IDLE;
  private tasks: readonly AutomationTask[] = [];
  private completedTasks = 0;
  private currentIndex = -1;
  private attempt = 0;
  private error: Error | null = null;

  /** Identifies the current run so a stale loop can never touch a newer run. */
  private runId = 0;
  private abort: AbortController | null = null;
  /** The in-flight run loop. Non-null until the loop has fully exited. */
  private loop: Promise<void> | null = null;
  private resumeWaiters: (() => void)[] = [];

  constructor(adapter: AutomationAdapter, config: Partial<EngineConfig> = {}) {
    this.adapter = adapter;
    this.config = { ...DEFAULT_CONFIG, ...config };
    validateConfig(this.config);
  }

  // ---- Public API --------------------------------------------------------------------------

  getState(): EngineState {
    return this.state;
  }

  getSnapshot(): EngineSnapshot {
    return {
      state: this.state,
      totalTasks: this.tasks.length,
      completedTasks: this.completedTasks,
      currentIndex: this.currentIndex,
      currentTaskId: this.tasks[this.currentIndex]?.id ?? null,
      attempt: this.attempt,
      error: this.error,
    };
  }

  /** Subscribe to every state/progress change. Returns an unsubscribe function. */
  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Begin executing `tasks`. Rejected (returns false) if a run is active, or if the previous
   * run's loop has not finished unwinding yet, so two runs can never overlap.
   */
  start(tasks: readonly AutomationTask[]): boolean {
    if (this.loop !== null || nextState(this.state, 'start') === null) return false;

    // Copy so later mutation of the caller's array cannot change a running job.
    this.tasks = tasks.map((t) => ({ ...t }));
    this.completedTasks = 0;
    this.currentIndex = -1;
    this.attempt = 0;
    this.error = null;
    this.abort = new AbortController();
    const id = ++this.runId;

    this.transition('start');
    this.loop = this.run(id, this.abort.signal).finally(() => {
      if (this.runId === id) this.loop = null;
    });
    return true;
  }

  pause(): boolean {
    return this.transition('pause');
  }

  resume(): boolean {
    if (!this.transition('resume')) return false;
    this.releaseResumeWaiters();
    return true;
  }

  stop(): boolean {
    if (!this.transition('stop')) return false;
    this.abort?.abort();
    this.releaseResumeWaiters();
    return true;
  }

  /** Resolves once the current run loop has fully exited (immediately if nothing is running). */
  async whenIdle(): Promise<void> {
    await this.loop;
  }

  // ---- Internals ---------------------------------------------------------------------------

  /** Applies a state-machine event. Returns false (and changes nothing) if it is not allowed. */
  private transition(event: EngineEvent): boolean {
    const next = nextState(this.state, event);
    if (next === null) return false;
    this.state = next;
    this.emit();
    return true;
  }

  private emit() {
    const snapshot = this.getSnapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch {
        // A faulty listener must not break the engine.
      }
    }
  }

  private isCurrent(id: number): boolean {
    return this.runId === id;
  }

  private releaseResumeWaiters() {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const wake of waiters) wake();
  }

  /**
   * Blocks while PAUSED. Returns true if the run may continue, false if it was stopped
   * (or superseded) and the loop must exit.
   */
  private async checkpoint(id: number): Promise<boolean> {
    while (this.isCurrent(id) && this.state === EngineState.PAUSED) {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    }
    return this.isCurrent(id) && this.state === EngineState.RUNNING;
  }

  /** Waits `ms`, ending early if `signal` aborts. */
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0 || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  private async run(id: number, signal: AbortSignal): Promise<void> {
    try {
      for (let i = 0; i < this.tasks.length; i++) {
        if (!(await this.checkpoint(id))) return;

        this.currentIndex = i;
        const task = this.tasks[i];
        const outcome = await this.executeWithRetry(id, task, signal);
        if (outcome === 'aborted') return;
        if (outcome instanceof Error) {
          this.error = outcome;
          this.transition('fail');
          return;
        }

        this.completedTasks++;
        this.emit();

        if (i < this.tasks.length - 1) {
          await this.sleep(task.delayMs ?? this.config.defaultDelayMs, signal);
        }
      }

      // If a pause was requested during the last task, wait for resume (or stop) before finishing.
      if (await this.checkpoint(id)) {
        this.currentIndex = -1;
        this.attempt = 0;
        this.transition('complete');
      }
    } catch (e) {
      // Defensive: nothing in the loop should throw, but never leave the engine stuck RUNNING.
      if (this.isCurrent(id) && this.state !== EngineState.STOPPED) {
        this.error = toError(e);
        this.transition('fail');
      }
    }
  }

  /**
   * Runs one task, retrying on failure. Resolves to `'ok'`, `'aborted'` (stopped/superseded
   * mid-task, result ignored) or the final `Error` once the retry limit is exhausted.
   */
  private async executeWithRetry(
    id: number,
    task: AutomationTask,
    signal: AbortSignal,
  ): Promise<'ok' | 'aborted' | Error> {
    const maxRetries = task.maxRetries ?? this.config.maxRetries;
    assertNonNegativeInt('maxRetries', maxRetries);

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      if (!(await this.checkpoint(id))) return 'aborted';

      this.attempt = attempt;
      this.emit();
      try {
        await this.adapter.execute(task, { attempt, signal });
        if (!this.isCurrent(id) || this.state === EngineState.STOPPED) return 'aborted';
        return 'ok';
      } catch (e) {
        // A failure that happens because we were stopped is not an engine error.
        if (!this.isCurrent(id) || this.state === EngineState.STOPPED) return 'aborted';
        lastError = toError(e);
        if (attempt <= maxRetries) await this.sleep(this.config.retryDelayMs, signal);
      }
    }
    return lastError ?? new Error(`Task ${task.id} failed`);
  }
}
