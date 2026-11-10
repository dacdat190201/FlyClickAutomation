import type { AutomationAdapter, AutomationTask, ExecutionContext } from './types';

export type MockAdapterOptions = {
  /** Simulated time each execution takes. Default 0 (resolves on a microtask). */
  latencyMs?: number;
  /** Task id -> number of attempts that fail before it succeeds. `Infinity` = always fails. */
  failures?: Record<string, number>;
};

export type MockCall = { taskId: string; attempt: number };

/**
 * Stand-in for the real adapter (clicks, OCR). Performs no side effects; records every call
 * so tests and demos can inspect what the engine did.
 */
export class MockAutomationAdapter implements AutomationAdapter {
  readonly calls: MockCall[] = [];
  /** Highest number of executions observed running at the same time. Should always be 1. */
  maxConcurrent = 0;

  private running = 0;
  private readonly latencyMs: number;
  private readonly remainingFailures = new Map<string, number>();

  constructor(options: MockAdapterOptions = {}) {
    this.latencyMs = options.latencyMs ?? 0;
    for (const [id, count] of Object.entries(options.failures ?? {})) {
      this.remainingFailures.set(id, count);
    }
  }

  async execute(task: AutomationTask, { attempt, signal }: ExecutionContext): Promise<void> {
    this.calls.push({ taskId: task.id, attempt });
    this.running++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.running);
    try {
      await this.simulateWork(signal);

      const left = this.remainingFailures.get(task.id) ?? 0;
      if (left > 0) {
        this.remainingFailures.set(task.id, left - 1);
        throw new Error(`Mock failure for task "${task.id}" (attempt ${attempt})`);
      }
    } finally {
      this.running--;
    }
  }

  private simulateWork(signal: AbortSignal): Promise<void> {
    if (this.latencyMs <= 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Error('Aborted'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, this.latencyMs);
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
