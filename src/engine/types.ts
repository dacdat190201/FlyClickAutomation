/**
 * Public types of the Automation Engine.
 * This module (src/engine) must stay independent from UI: no React, Expo or React Native imports.
 */

export const EngineState = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  STOPPED: 'STOPPED',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
} as const;

// Same name for the value and the type on purpose (enum-like const object pattern).
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type EngineState = (typeof EngineState)[keyof typeof EngineState];

/** One unit of work, e.g. a click or an OCR check. The engine does not interpret `type`/`payload`. */
export type AutomationTask = {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  /** Delay after this task succeeds, before the next one starts. Defaults to `config.defaultDelayMs`. */
  delayMs?: number;
  /** Overrides `config.maxRetries` for this task. */
  maxRetries?: number;
};

export type ExecutionContext = {
  /** 1-based attempt number for the current task. */
  attempt: number;
  /** Aborted when the engine is stopped. Adapters should stop work promptly when it fires. */
  signal: AbortSignal;
};

/** Boundary to the outside world (real clicks, OCR, ...). Throw or reject to signal failure. */
export interface AutomationAdapter {
  execute(task: AutomationTask, context: ExecutionContext): Promise<void>;
}

export type EngineConfig = {
  /** Delay between tasks when a task does not set its own `delayMs`. Default 0. */
  defaultDelayMs: number;
  /** Retries after the first failed attempt (so total attempts = maxRetries + 1). Default 0. */
  maxRetries: number;
  /** Wait before retrying a failed attempt. Default 0. */
  retryDelayMs: number;
};

export type EngineSnapshot = {
  state: EngineState;
  totalTasks: number;
  /** Number of tasks that finished successfully. */
  completedTasks: number;
  /** Index of the task being processed, or -1 when not running. */
  currentIndex: number;
  currentTaskId: string | null;
  /** Attempt number of the current task (0 when idle). */
  attempt: number;
  /** Set when state is ERROR. */
  error: Error | null;
};

export type EngineListener = (snapshot: EngineSnapshot) => void;

export type EngineCommand = 'start' | 'pause' | 'resume' | 'stop';
