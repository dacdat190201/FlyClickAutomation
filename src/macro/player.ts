import type { ClickEngine } from '../click';
import {
  AutomationEngine,
  EngineState,
  type AutomationAdapter,
  type AutomationTask,
} from '../engine';
import { makeReport, type Macro, type MacroStep, type Report } from './types';
import { validateForPlayback } from './validation';

export type PlaybackProgress = {
  state: EngineState;
  completedSteps: number;
  totalSteps: number;
  /** 1-based repetition being played, 0 before the first step. */
  repeat: number;
  /** Index of the step being played, -1 when none. */
  stepIndex: number;
  stepId: string | null;
};

export type PlaybackResult = {
  status: 'completed' | 'stopped' | 'failed';
  stepsExecuted: number;
  totalSteps: number;
  error?: Error;
  failedStepId?: string;
};

export type PlayerDeps = {
  clicker: ClickEngine;
  /** Screen size in the adapter's coordinate space, used to reject out-of-bounds taps. */
  screen?: { width: number; height: number };
  /** For adapters that only press this app's own controls. */
  hitTest?: (x: number, y: number) => boolean;
};

export type PlayOptions = {
  /** Retries of a step whose click fails with a retryable error. Default 0. */
  maxRetries?: number;
};

type TaskMeta = { repeat: number; stepIndex: number; stepId: string | null };

/**
 * Plays a macro through the Click Engine, one step after another. The Automation Engine
 * provides sequencing, delays, pause/resume/stop and the ERROR state. A macro is validated
 * for this platform before anything is clicked; if validation fails nothing runs.
 *
 * Recorded steps are intentional, so the Click Engine's repeated-click guard is bypassed
 * (`allowRepeat`); its interval, timeout and tap-duration handling still apply.
 */
export class MacroPlayer {
  private readonly deps: PlayerDeps;
  private readonly engine: AutomationEngine;
  private meta: TaskMeta[] = [];
  private hasLead = false;
  private totalSteps = 0;

  constructor(deps: PlayerDeps) {
    this.deps = deps;
    const adapter: AutomationAdapter = { execute: (task, ctx) => this.execute(task, ctx.signal) };
    this.engine = new AutomationEngine(adapter, { maxRetries: 0, defaultDelayMs: 0, retryDelayMs: 0 });
  }

  /** Checks a macro against this platform's click adapter. */
  validate(macro: Macro): Report {
    return validateForPlayback(macro, {
      platform: this.deps.clicker.platform,
      capabilities: this.deps.clicker.capabilities,
      screen: this.deps.screen,
      hitTest: this.deps.hitTest,
    });
  }

  /** Validates and starts. `started` is false (and nothing runs) if validation fails or a run is active. */
  start(macro: Macro, options: PlayOptions = {}): { started: boolean; report: Report } {
    const report = this.validate(macro);
    if (!report.ok) return { started: false, report };

    const { tasks, meta, hasLead } = this.plan(macro, options.maxRetries ?? 0);
    if (!this.engine.start(tasks)) {
      return { started: false, report: makeReport([...report.issues, { level: 'error', code: 'ALREADY_PLAYING', message: 'A macro is already playing' }]) };
    }
    this.meta = meta;
    this.hasLead = hasLead;
    this.totalSteps = macro.steps.length * macro.repeat.count;
    return { started: true, report };
  }

  pause(): boolean {
    return this.engine.pause();
  }

  resume(): boolean {
    return this.engine.resume();
  }

  stop(): boolean {
    return this.engine.stop();
  }

  getProgress(): PlaybackProgress {
    const s = this.engine.getSnapshot();
    const meta = this.meta[s.currentIndex];
    return {
      state: s.state,
      completedSteps: this.executedSteps(s.completedTasks),
      totalSteps: this.totalSteps,
      repeat: meta ? meta.repeat + 1 : 0,
      stepIndex: meta ? meta.stepIndex : -1,
      stepId: meta?.stepId ?? null,
    };
  }

  subscribe(listener: (progress: PlaybackProgress) => void): () => void {
    return this.engine.subscribe(() => listener(this.getProgress()));
  }

  /** Resolves with the outcome once playback has finished. */
  async whenDone(): Promise<PlaybackResult> {
    await this.engine.whenIdle();
    const s = this.engine.getSnapshot();
    const base = { stepsExecuted: this.executedSteps(s.completedTasks), totalSteps: this.totalSteps };
    switch (s.state) {
      case EngineState.COMPLETED:
        return { status: 'completed', ...base };
      case EngineState.ERROR:
        return {
          status: 'failed',
          ...base,
          error: s.error ?? undefined,
          failedStepId: this.meta[s.currentIndex]?.stepId ?? undefined,
        };
      default:
        return { status: 'stopped', ...base };
    }
  }

  // ---- internals ---------------------------------------------------------------------------

  private executedSteps(completedTasks: number): number {
    return Math.max(0, completedTasks - (this.hasLead && completedTasks > 0 ? 1 : 0));
  }

  /**
   * One task per step per repetition. The Automation Engine waits `delayMs` after a task, so a
   * task carries the delay of whatever comes next (the next step, or the next repetition).
   */
  private plan(macro: Macro, maxRetries: number) {
    const { steps, repeat } = macro;
    const tasks: AutomationTask[] = [];
    const meta: TaskMeta[] = [];

    const lead = steps[0].delayMs;
    if (lead > 0) {
      tasks.push({ id: 'lead', type: 'lead', delayMs: lead });
      meta.push({ repeat: 0, stepIndex: -1, stepId: null });
    }

    for (let r = 0; r < repeat.count; r++) {
      steps.forEach((step, i) => {
        const next =
          i < steps.length - 1
            ? steps[i + 1].delayMs
            : r < repeat.count - 1
              ? repeat.delayBetweenMs + steps[0].delayMs
              : 0;
        tasks.push({
          id: `r${r}:s${i}:${step.id}`,
          type: step.type,
          payload: { step },
          delayMs: (step.type === 'wait' ? step.durationMs : 0) + next,
          maxRetries,
        });
        meta.push({ repeat: r, stepIndex: i, stepId: step.id });
      });
    }
    return { tasks, meta, hasLead: lead > 0 };
  }

  private async execute(task: AutomationTask, signal: AbortSignal): Promise<void> {
    switch (task.type) {
      case 'lead':
      case 'wait':
        return; // the wait is the delay the engine applies after this task
      case 'tap': {
        const step = task.payload!.step as Extract<MacroStep, { type: 'tap' }>;
        await this.deps.clicker.click(
          { x: step.x, y: step.y, durationMs: step.durationMs },
          { allowRepeat: true, signal },
        );
        return;
      }
      default:
        throw new Error(`Step type "${task.type}" cannot be played`);
    }
  }
}
