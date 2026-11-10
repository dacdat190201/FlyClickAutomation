import {
  AutomationEngine,
  EngineState,
  MockAutomationAdapter,
  type AutomationAdapter,
  type AutomationTask,
  type EngineConfig,
  type EngineSnapshot,
} from '..';

const task = (id: string, extra: Partial<AutomationTask> = {}): AutomationTask => ({
  id,
  type: 'click',
  ...extra,
});

const tasks = (...ids: string[]) => ids.map((id) => task(id));

function setup(
  adapterOptions: ConstructorParameters<typeof MockAutomationAdapter>[0] = {},
  config: Partial<EngineConfig> = {},
) {
  const adapter = new MockAutomationAdapter(adapterOptions);
  const engine = new AutomationEngine(adapter, config);
  const states: EngineState[] = [];
  engine.subscribe((s) => {
    if (states[states.length - 1] !== s.state) states.push(s.state);
  });
  return { adapter, engine, states };
}

const ids = (adapter: MockAutomationAdapter) => adapter.calls.map((c) => c.taskId);

describe('AutomationEngine', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('lifecycle', () => {
    it('starts IDLE', () => {
      const { engine } = setup();
      expect(engine.getState()).toBe(EngineState.IDLE);
      expect(engine.getSnapshot()).toMatchObject({ totalTasks: 0, currentIndex: -1, error: null });
    });

    it('runs all tasks in order and ends COMPLETED', async () => {
      const { engine, adapter, states } = setup();
      expect(engine.start(tasks('a', 'b', 'c'))).toBe(true);
      await engine.whenIdle();

      expect(ids(adapter)).toEqual(['a', 'b', 'c']);
      expect(engine.getState()).toBe(EngineState.COMPLETED);
      expect(engine.getSnapshot()).toMatchObject({ completedTasks: 3, totalTasks: 3, error: null });
      expect(states).toEqual([EngineState.RUNNING, EngineState.COMPLETED]);
    });

    it('completes immediately for an empty task list', async () => {
      const { engine } = setup();
      engine.start([]);
      await engine.whenIdle();
      expect(engine.getState()).toBe(EngineState.COMPLETED);
    });

    it('can be restarted after COMPLETED, resetting progress', async () => {
      const { engine, adapter } = setup();
      engine.start(tasks('a'));
      await engine.whenIdle();

      expect(engine.start(tasks('b', 'c'))).toBe(true);
      await engine.whenIdle();

      expect(ids(adapter)).toEqual(['a', 'b', 'c']);
      expect(engine.getSnapshot()).toMatchObject({ completedTasks: 2, totalTasks: 2 });
    });
  });

  describe('sequential execution', () => {
    it('never runs two tasks at the same time', async () => {
      const { engine, adapter } = setup({ latencyMs: 50 });
      engine.start(tasks('a', 'b', 'c'));
      await jest.advanceTimersByTimeAsync(500);
      await engine.whenIdle();

      expect(ids(adapter)).toEqual(['a', 'b', 'c']);
      expect(adapter.maxConcurrent).toBe(1);
    });

    it('does not start the next task until the current one finishes', async () => {
      const { engine, adapter } = setup({ latencyMs: 100 });
      engine.start(tasks('a', 'b'));

      await jest.advanceTimersByTimeAsync(99);
      expect(ids(adapter)).toEqual(['a']);
      await jest.advanceTimersByTimeAsync(1);
      expect(ids(adapter)).toEqual(['a', 'b']);

      await jest.advanceTimersByTimeAsync(100);
      expect(engine.getState()).toBe(EngineState.COMPLETED);
    });

    it('reports progress through snapshots', async () => {
      const { engine } = setup({ latencyMs: 10 });
      const seen: Pick<EngineSnapshot, 'currentTaskId' | 'completedTasks'>[] = [];
      engine.subscribe((s) =>
        seen.push({ currentTaskId: s.currentTaskId, completedTasks: s.completedTasks }),
      );
      engine.start(tasks('a', 'b'));
      await jest.advanceTimersByTimeAsync(100);

      expect(seen).toContainEqual({ currentTaskId: 'a', completedTasks: 0 });
      expect(seen).toContainEqual({ currentTaskId: 'b', completedTasks: 1 });
    });
  });

  describe('delays', () => {
    it('waits defaultDelayMs between tasks but not after the last one', async () => {
      const { engine, adapter } = setup({}, { defaultDelayMs: 1000 });
      engine.start(tasks('a', 'b', 'c'));

      await jest.advanceTimersByTimeAsync(0);
      expect(ids(adapter)).toEqual(['a']);
      await jest.advanceTimersByTimeAsync(999);
      expect(ids(adapter)).toEqual(['a']);
      await jest.advanceTimersByTimeAsync(1);
      expect(ids(adapter)).toEqual(['a', 'b']);
      await jest.advanceTimersByTimeAsync(1000);

      // No trailing delay after the last task.
      expect(engine.getState()).toBe(EngineState.COMPLETED);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('lets a task override the delay that follows it', async () => {
      const { engine, adapter } = setup({}, { defaultDelayMs: 1000 });
      engine.start([task('a', { delayMs: 50 }), task('b')]);

      await jest.advanceTimersByTimeAsync(49);
      expect(ids(adapter)).toEqual(['a']);
      await jest.advanceTimersByTimeAsync(1);
      expect(ids(adapter)).toEqual(['a', 'b']);
    });
  });

  describe('retries', () => {
    it('retries a failing task and succeeds within the limit', async () => {
      const { engine, adapter } = setup({ failures: { a: 2 } }, { maxRetries: 2 });
      engine.start(tasks('a', 'b'));
      await engine.whenIdle();

      expect(adapter.calls).toEqual([
        { taskId: 'a', attempt: 1 },
        { taskId: 'a', attempt: 2 },
        { taskId: 'a', attempt: 3 },
        { taskId: 'b', attempt: 1 },
      ]);
      expect(engine.getState()).toBe(EngineState.COMPLETED);
    });

    it('goes to ERROR once retries are exhausted and does not run later tasks', async () => {
      const { engine, adapter } = setup({ failures: { a: Infinity } }, { maxRetries: 2 });
      engine.start(tasks('a', 'b'));
      await engine.whenIdle();

      expect(adapter.calls).toHaveLength(3); // 1 try + 2 retries
      expect(ids(adapter)).not.toContain('b');
      expect(engine.getState()).toBe(EngineState.ERROR);
      expect(engine.getSnapshot().error?.message).toMatch(/Mock failure for task "a"/);
      expect(engine.getSnapshot().completedTasks).toBe(0);
    });

    it('fails on the first error when maxRetries is 0 (default)', async () => {
      const { engine, adapter } = setup({ failures: { a: 1 } });
      engine.start(tasks('a'));
      await engine.whenIdle();

      expect(adapter.calls).toHaveLength(1);
      expect(engine.getState()).toBe(EngineState.ERROR);
    });

    it('lets a task override maxRetries', async () => {
      const { engine, adapter } = setup({ failures: { a: 3 } }, { maxRetries: 0 });
      engine.start([task('a', { maxRetries: 3 })]);
      await engine.whenIdle();

      expect(adapter.calls).toHaveLength(4);
      expect(engine.getState()).toBe(EngineState.COMPLETED);
    });

    it('waits retryDelayMs between attempts', async () => {
      const { engine, adapter } = setup({ failures: { a: 1 } }, { maxRetries: 1, retryDelayMs: 500 });
      engine.start(tasks('a'));

      await jest.advanceTimersByTimeAsync(499);
      expect(adapter.calls).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(adapter.calls).toHaveLength(2);
      expect(engine.getState()).toBe(EngineState.COMPLETED);
    });

    it('can be restarted after ERROR', async () => {
      const { engine } = setup({ failures: { a: 1 } });
      engine.start(tasks('a'));
      await engine.whenIdle();
      expect(engine.getState()).toBe(EngineState.ERROR);

      expect(engine.start(tasks('a'))).toBe(true); // mock failure budget is spent, so it passes
      await engine.whenIdle();
      expect(engine.getState()).toBe(EngineState.COMPLETED);
      expect(engine.getSnapshot().error).toBeNull();
    });
  });

  describe('pause / resume', () => {
    it('pauses between tasks and continues after resume', async () => {
      const { engine, adapter, states } = setup({ latencyMs: 100 });
      engine.start(tasks('a', 'b'));
      await jest.advanceTimersByTimeAsync(50);

      expect(engine.pause()).toBe(true);
      expect(engine.getState()).toBe(EngineState.PAUSED);

      // Task "a" is allowed to finish, but "b" must not begin while paused.
      await jest.advanceTimersByTimeAsync(1000);
      expect(ids(adapter)).toEqual(['a']);
      expect(engine.getState()).toBe(EngineState.PAUSED);

      expect(engine.resume()).toBe(true);
      await jest.advanceTimersByTimeAsync(100);
      await engine.whenIdle();

      expect(ids(adapter)).toEqual(['a', 'b']);
      expect(states).toEqual([
        EngineState.RUNNING,
        EngineState.PAUSED,
        EngineState.RUNNING,
        EngineState.COMPLETED,
      ]);
    });

    it('does not finish while paused after the last task, completes on resume', async () => {
      const { engine } = setup({ latencyMs: 100 });
      engine.start(tasks('a'));
      await jest.advanceTimersByTimeAsync(10);
      engine.pause();

      await jest.advanceTimersByTimeAsync(500);
      expect(engine.getState()).toBe(EngineState.PAUSED);

      engine.resume();
      await engine.whenIdle();
      expect(engine.getState()).toBe(EngineState.COMPLETED);
    });

    it('goes to ERROR if the in-flight task fails while pause is pending', async () => {
      const { engine } = setup({ latencyMs: 100, failures: { a: Infinity } });
      engine.start(tasks('a', 'b'));
      await jest.advanceTimersByTimeAsync(10);
      engine.pause();

      await jest.advanceTimersByTimeAsync(200);
      await engine.whenIdle();
      expect(engine.getState()).toBe(EngineState.ERROR);
    });

    it('rejects invalid pause/resume', () => {
      const { engine } = setup();
      expect(engine.pause()).toBe(false); // IDLE
      expect(engine.resume()).toBe(false); // IDLE
      engine.start(tasks('a'));
      expect(engine.resume()).toBe(false); // RUNNING
      engine.pause();
      expect(engine.pause()).toBe(false); // already PAUSED
    });
  });

  describe('stop', () => {
    it('stops a running engine and skips remaining tasks', async () => {
      const { engine, adapter } = setup({ latencyMs: 100 });
      engine.start(tasks('a', 'b', 'c'));
      await jest.advanceTimersByTimeAsync(150); // a done, b in flight

      expect(engine.stop()).toBe(true);
      await engine.whenIdle();
      await jest.advanceTimersByTimeAsync(1000);

      expect(ids(adapter)).toEqual(['a', 'b']);
      expect(engine.getState()).toBe(EngineState.STOPPED);
      expect(engine.getSnapshot().completedTasks).toBe(1);
    });

    it('aborts the signal passed to the adapter', async () => {
      let received: AbortSignal | undefined;
      const adapter: AutomationAdapter = {
        execute: (_t, { signal }) => {
          received = signal;
          return new Promise<void>(() => {}); // never settles on its own
        },
      };
      const engine = new AutomationEngine(adapter);
      engine.start(tasks('a'));
      await jest.advanceTimersByTimeAsync(0);

      expect(received?.aborted).toBe(false);
      engine.stop();
      expect(received?.aborted).toBe(true);
    });

    it('cancels a pending delay immediately', async () => {
      const { engine, adapter } = setup({}, { defaultDelayMs: 10_000 });
      engine.start(tasks('a', 'b'));
      await jest.advanceTimersByTimeAsync(0);

      engine.stop();
      await engine.whenIdle();

      expect(ids(adapter)).toEqual(['a']);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('stops from PAUSED and releases the waiting loop', async () => {
      const { engine, adapter } = setup({ latencyMs: 100 });
      engine.start(tasks('a', 'b'));
      await jest.advanceTimersByTimeAsync(10);
      engine.pause();
      await jest.advanceTimersByTimeAsync(200);

      expect(engine.stop()).toBe(true);
      await engine.whenIdle(); // would hang if the paused loop were not released
      expect(engine.getState()).toBe(EngineState.STOPPED);
      expect(ids(adapter)).toEqual(['a']);
    });

    it('does not turn a failure caused by stop into ERROR', async () => {
      // MockAutomationAdapter rejects when aborted mid-flight.
      const { engine } = setup({ latencyMs: 100 });
      engine.start(tasks('a'));
      await jest.advanceTimersByTimeAsync(10);

      engine.stop();
      await engine.whenIdle();
      expect(engine.getState()).toBe(EngineState.STOPPED);
      expect(engine.getSnapshot().error).toBeNull();
    });

    it('rejects stop when nothing is running', async () => {
      const { engine } = setup();
      expect(engine.stop()).toBe(false); // IDLE
      engine.start(tasks('a'));
      await engine.whenIdle();
      expect(engine.stop()).toBe(false); // COMPLETED
    });

    it('can be restarted after STOPPED', async () => {
      const { engine, adapter } = setup({ latencyMs: 50 });
      engine.start(tasks('a', 'b'));
      await jest.advanceTimersByTimeAsync(10);
      engine.stop();
      await engine.whenIdle();

      expect(engine.start(tasks('c'))).toBe(true);
      await jest.advanceTimersByTimeAsync(100);
      await engine.whenIdle();

      expect(engine.getState()).toBe(EngineState.COMPLETED);
      expect(ids(adapter)).toEqual(['a', 'c']);
    });
  });

  describe('duplicate execution', () => {
    it('rejects start while RUNNING', async () => {
      const { engine, adapter } = setup({ latencyMs: 50 });
      expect(engine.start(tasks('a'))).toBe(true);
      expect(engine.start(tasks('x', 'y'))).toBe(false);

      await jest.advanceTimersByTimeAsync(100);
      await engine.whenIdle();
      expect(ids(adapter)).toEqual(['a']);
    });

    it('rejects start while PAUSED', async () => {
      const { engine } = setup({ latencyMs: 50 });
      engine.start(tasks('a', 'b'));
      await jest.advanceTimersByTimeAsync(10);
      engine.pause();
      expect(engine.start(tasks('x'))).toBe(false);
    });

    it('rejects a restart while the previous run is still unwinding', async () => {
      // Adapter ignores the abort signal, so the stopped run's task is still in flight.
      let finish: () => void = () => {};
      const adapter: AutomationAdapter = {
        execute: () => new Promise<void>((resolve) => (finish = resolve)),
      };
      const engine = new AutomationEngine(adapter);
      engine.start(tasks('a'));
      await jest.advanceTimersByTimeAsync(0);
      engine.stop();

      expect(engine.getState()).toBe(EngineState.STOPPED);
      expect(engine.start(tasks('b'))).toBe(false); // old task has not settled yet

      finish();
      await engine.whenIdle();
      expect(engine.start(tasks('b'))).toBe(true);
    });

    it('does not let a stale run affect a new run', async () => {
      const { engine, adapter } = setup({ latencyMs: 100 });
      engine.start(tasks('old1', 'old2'));
      await jest.advanceTimersByTimeAsync(10);
      engine.stop();
      await engine.whenIdle();

      engine.start(tasks('new1'));
      await jest.advanceTimersByTimeAsync(500);
      await engine.whenIdle();

      expect(ids(adapter)).toEqual(['old1', 'new1']);
      expect(adapter.maxConcurrent).toBe(1);
      expect(engine.getState()).toBe(EngineState.COMPLETED);
    });
  });

  describe('error handling', () => {
    it('captures an adapter that throws synchronously', async () => {
      const adapter: AutomationAdapter = {
        execute: () => {
          throw new Error('boom');
        },
      };
      const engine = new AutomationEngine(adapter);
      engine.start(tasks('a'));
      await engine.whenIdle();

      expect(engine.getState()).toBe(EngineState.ERROR);
      expect(engine.getSnapshot().error?.message).toBe('boom');
    });

    it('wraps non-Error rejections in an Error', async () => {
      const adapter: AutomationAdapter = { execute: () => Promise.reject('plain string') };
      const engine = new AutomationEngine(adapter);
      engine.start(tasks('a'));
      await engine.whenIdle();

      expect(engine.getSnapshot().error).toBeInstanceOf(Error);
      expect(engine.getSnapshot().error?.message).toBe('plain string');
    });

    it('survives a throwing listener', async () => {
      const { engine, adapter } = setup();
      engine.subscribe(() => {
        throw new Error('listener bug');
      });
      engine.start(tasks('a', 'b'));
      await engine.whenIdle();

      expect(ids(adapter)).toEqual(['a', 'b']);
      expect(engine.getState()).toBe(EngineState.COMPLETED);
    });

    it('stops notifying after unsubscribe', async () => {
      const { engine } = setup();
      const listener = jest.fn();
      const off = engine.subscribe(listener);
      off();
      engine.start(tasks('a'));
      await engine.whenIdle();
      expect(listener).not.toHaveBeenCalled();
    });

    it('is not affected by the caller mutating the task array after start', async () => {
      const { engine, adapter } = setup({ latencyMs: 10 });
      const list = tasks('a', 'b');
      engine.start(list);
      list.length = 0;
      await jest.advanceTimersByTimeAsync(100);
      await engine.whenIdle();

      expect(ids(adapter)).toEqual(['a', 'b']);
    });

    it('validates config', () => {
      const adapter = new MockAutomationAdapter();
      expect(() => new AutomationEngine(adapter, { maxRetries: -1 })).toThrow(RangeError);
      expect(() => new AutomationEngine(adapter, { defaultDelayMs: 1.5 })).toThrow(RangeError);
      expect(() => new AutomationEngine(adapter, { retryDelayMs: NaN })).toThrow(RangeError);
    });

    it('turns an invalid per-task maxRetries into ERROR instead of throwing', async () => {
      const { engine } = setup();
      expect(() => engine.start([task('a', { maxRetries: -1 })])).not.toThrow();
      await engine.whenIdle();
      expect(engine.getState()).toBe(EngineState.ERROR);
    });
  });
});
