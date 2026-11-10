import { formatCountdown, TimerEngine, type TimerAction, type TimerConfig } from '..';

const T0 = 1_000_000;

/** Builds an engine whose action records the time (relative to T0) each run started. */
function make(config: Partial<TimerConfig> = {}, impl?: TimerAction) {
  const runs: number[] = [];
  const contexts: Parameters<TimerAction>[0][] = [];
  const action: TimerAction = async (ctx) => {
    runs.push(Date.now() - T0);
    contexts.push(ctx);
    await impl?.(ctx);
  };
  const engine = new TimerEngine(action, config);
  return { engine, runs, contexts };
}

const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('TimerEngine', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
  });
  afterEach(() => jest.useRealTimers());

  describe('start delay', () => {
    it('does not run before the delay, then runs once and completes', async () => {
      const { engine, runs } = make({ startDelayMs: 5000 });
      expect(engine.start()).toBe(true);
      expect(engine.getState()).toBe('WAITING');

      await advance(4999);
      expect(runs).toEqual([]);
      await advance(1);
      expect(runs).toEqual([5000]);
      await engine.whenIdle();
      await advance(0);
      expect(engine.getState()).toBe('COMPLETED');
    });

    it('never runs the action synchronously inside start()', () => {
      const { engine, runs } = make();
      engine.start();
      expect(runs).toEqual([]);
    });

    it('starts right away (next tick) with no delay', async () => {
      const { engine, runs } = make();
      engine.start();
      await advance(0);
      expect(runs).toEqual([0]);
    });
  });

  describe('repetition', () => {
    it('repeats at a fixed interval and stops after maxRepetitions', async () => {
      const { engine, runs } = make({ intervalMs: 1000, maxRepetitions: 3 });
      engine.start();
      await advance(10_000);

      expect(runs).toEqual([0, 1000, 2000]);
      expect(engine.getState()).toBe('COMPLETED');
      expect(engine.getSnapshot().runCount).toBe(3);
    });

    it('runs forever when unlimited, until stopped', async () => {
      const { engine, runs } = make({ intervalMs: 1000 });
      engine.start();
      await advance(10_500);
      expect(runs).toHaveLength(11);
      expect(engine.getState()).toBe('RUNNING');

      expect(engine.stop()).toBe(true);
      await advance(10_000);
      expect(runs).toHaveLength(11);
      expect(engine.getState()).toBe('STOPPED');
    });

    it('keeps a fixed rate (no drift) even when the action takes time', async () => {
      const { engine, runs } = make({ intervalMs: 1000, maxRepetitions: 4 }, () => sleep(300));
      engine.start();
      await advance(5000);
      expect(runs).toEqual([0, 1000, 2000, 3000]);
    });

    it('applies the start delay before the first slot', async () => {
      const { engine, runs } = make({ startDelayMs: 2000, intervalMs: 500, maxRepetitions: 3 });
      engine.start();
      await advance(5000);
      expect(runs).toEqual([2000, 2500, 3000]);
    });

    it('runs exactly once when there is no interval', async () => {
      const { engine, runs } = make({ maxRepetitions: 1 });
      engine.start();
      await advance(5000);
      expect(runs).toHaveLength(1);
      expect(engine.getState()).toBe('COMPLETED');
    });
  });

  describe('duration', () => {
    it('runs for the duration, then completes automatically', async () => {
      const { engine, runs } = make({ intervalMs: 1000, durationMs: 3500 });
      engine.start();
      await advance(10_000);

      expect(runs).toEqual([0, 1000, 2000, 3000]);
      expect(engine.getState()).toBe('COMPLETED');
    });

    it('measures the duration from the end of the start delay', async () => {
      const { engine, runs } = make({ startDelayMs: 2000, intervalMs: 1000, durationMs: 2500 });
      engine.start();
      await advance(10_000);
      expect(runs).toEqual([2000, 3000, 4000]);
    });

    it('does not run a slot that falls exactly at the end of the window', async () => {
      const { engine, runs } = make({ intervalMs: 1000, durationMs: 3000 });
      engine.start();
      await advance(10_000);
      expect(runs).toEqual([0, 1000, 2000]);
    });

    it('stops at whichever limit comes first', async () => {
      const byCount = make({ intervalMs: 1000, durationMs: 60_000, maxRepetitions: 2 });
      byCount.engine.start();
      await advance(10_000);
      expect(byCount.runs).toHaveLength(2);

      const byTime = make({ intervalMs: 1000, durationMs: 1500, maxRepetitions: 100 });
      byTime.engine.start();
      await advance(10_000);
      expect(byTime.runs).toHaveLength(2);
    });

    it('aborts a long action at the window end, then completes once it settles', async () => {
      const { engine, contexts } = make({ durationMs: 1000 }, (ctx) =>
        new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve())),
      );
      engine.start();
      await advance(500);
      expect(contexts[0].signal.aborted).toBe(false);

      await advance(500);
      expect(contexts[0].signal.aborted).toBe(true);
      await engine.whenIdle();
      expect(engine.getState()).toBe('COMPLETED');
    });
  });

  describe('overlap', () => {
    it('never runs two actions at once; overdue slots follow the missedRuns policy', async () => {
      let concurrent = 0;
      let peak = 0;
      const { engine, runs } = make({ intervalMs: 1000, maxRepetitions: 5, missedRuns: 'skip' }, async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await sleep(2500); // longer than two intervals
        concurrent--;
      });
      engine.start();
      await advance(30_000);

      expect(peak).toBe(1);
      expect(engine.getSnapshot().skippedRuns).toBeGreaterThan(0);
      expect(runs.length).toBeLessThan(5);
    });
  });

  describe('pause and resume', () => {
    it('freezes the countdown while paused and shifts the schedule on resume', async () => {
      const { engine, runs } = make({ intervalMs: 1000, maxRepetitions: 3 });
      engine.start();
      await advance(1500); // runs at 0 and 1000
      expect(runs).toEqual([0, 1000]);
      const before = engine.getSnapshot().countdownMs;

      expect(engine.pause()).toBe(true);
      await advance(60_000);
      expect(runs).toEqual([0, 1000]);
      expect(engine.getSnapshot().countdownMs).toBe(before); // frozen
      expect(engine.getState()).toBe('PAUSED');

      expect(engine.resume()).toBe(true);
      await advance(before! - 1);
      expect(runs).toHaveLength(2);
      await advance(1);
      expect(runs).toHaveLength(3);
    });

    it('does not count paused time against the duration', async () => {
      const { engine, runs } = make({ intervalMs: 1000, durationMs: 2500 });
      engine.start();
      await advance(1500);
      engine.pause();
      await advance(1_000_000);
      engine.resume();
      await advance(10_000);

      expect(runs).toHaveLength(3); // slots 0, 1000, 2000 as if never paused
      expect(engine.getState()).toBe('COMPLETED');
    });

    it('can pause during the start delay', async () => {
      const { engine, runs } = make({ startDelayMs: 5000 });
      engine.start();
      await advance(2000);
      engine.pause();
      expect(engine.getSnapshot().countdownMs).toBe(3000);
      await advance(100_000);
      expect(runs).toEqual([]);

      engine.resume();
      await advance(2999);
      expect(runs).toEqual([]);
      await advance(1);
      expect(runs).toHaveLength(1);
    });

    it('lets an in-flight action finish while paused, then waits for resume', async () => {
      const { engine, runs } = make({ intervalMs: 1000, maxRepetitions: 3 }, () => sleep(800));
      engine.start();
      await advance(100);
      engine.pause();
      await advance(5000);
      expect(runs).toHaveLength(1);
      expect(engine.getSnapshot().executing).toBe(false);

      engine.resume();
      await advance(10_000);
      expect(runs.length).toBeGreaterThan(1);
    });

    it('rejects invalid pause/resume', () => {
      const { engine } = make();
      expect(engine.pause()).toBe(false);
      expect(engine.resume()).toBe(false);
      engine.start();
      expect(engine.resume()).toBe(false);
      engine.pause();
      expect(engine.pause()).toBe(false);
    });
  });

  describe('stop and restart', () => {
    it('stops automatically after completion, and cannot be stopped again', async () => {
      const { engine } = make({ maxRepetitions: 1 });
      engine.start();
      await advance(100);
      expect(engine.getState()).toBe('COMPLETED');
      expect(engine.stop()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('aborts the signal on stop', async () => {
      const { engine, contexts } = make({}, () => new Promise<void>(() => {}));
      engine.start();
      await advance(10);
      engine.stop();
      expect(contexts[0].signal.aborted).toBe(true);
    });

    it('refuses a second start while active or while the last action is still settling', async () => {
      let finish: () => void = () => {};
      const { engine } = make({}, () => new Promise<void>((r) => (finish = r)));
      expect(engine.start()).toBe(true);
      expect(engine.start()).toBe(false);
      await advance(10);
      engine.stop();
      expect(engine.start()).toBe(false); // action still running
      finish();
      await engine.whenIdle();
      expect(engine.start()).toBe(true);
    });

    it('can run again after completing, with fresh counters', async () => {
      const { engine, runs } = make({ intervalMs: 100, maxRepetitions: 2 });
      engine.start();
      await advance(1000);
      expect(engine.getSnapshot().runCount).toBe(2);

      engine.start();
      expect(engine.getSnapshot().runCount).toBe(0);
      await advance(1000);
      expect(runs).toHaveLength(4);
    });
  });

  describe('errors', () => {
    it('moves to ERROR when the action throws (default)', async () => {
      const { engine, runs } = make({ intervalMs: 100 }, () => {
        throw new Error('boom');
      });
      engine.start();
      await advance(1000);

      expect(engine.getState()).toBe('ERROR');
      expect(engine.getSnapshot().error?.message).toBe('boom');
      expect(runs).toHaveLength(1);
    });

    it('can keep going after errors', async () => {
      const { engine, runs } = make({ intervalMs: 100, maxRepetitions: 3, stopOnError: false }, () => {
        throw new Error('boom');
      });
      engine.start();
      await advance(1000);

      expect(runs).toHaveLength(3);
      expect(engine.getState()).toBe('COMPLETED');
      expect(engine.getSnapshot().lastRun?.error?.message).toBe('boom');
    });

    it('wraps non-Error throws', async () => {
      const { engine } = make({}, () => Promise.reject('plain'));
      engine.start();
      await advance(10);
      expect(engine.getSnapshot().error?.message).toBe('plain');
    });

    it('survives a throwing listener', async () => {
      const { engine, runs } = make({ intervalMs: 100, maxRepetitions: 2 });
      engine.subscribe(() => {
        throw new Error('listener bug');
      });
      engine.start();
      await advance(1000);
      expect(runs).toHaveLength(2);
      expect(engine.getState()).toBe('COMPLETED');
    });
  });

  describe('countdown and status', () => {
    it('reports the countdown to the start, then to each run', async () => {
      const { engine } = make({ startDelayMs: 3000, intervalMs: 2000, durationMs: 10_000 });
      expect(engine.getSnapshot()).toMatchObject({ state: 'IDLE', phase: 'idle', countdownMs: null });

      engine.start();
      expect(engine.getSnapshot()).toMatchObject({ phase: 'waiting', countdownMs: 3000, remainingMs: 10_000 });
      await advance(1000);
      expect(engine.getSnapshot().countdownMs).toBe(2000);

      await advance(2500); // t=3500: run 1 at 3000 done, next at 5000
      const s = engine.getSnapshot();
      expect(s).toMatchObject({ phase: 'running', runCount: 1, countdownMs: 1500, remainingMs: 9500 });
      expect(s.nextRunAt).toBe(Date.now() + 1500);
      expect(s.elapsedMs).toBe(3500);
    });

    it('describes the last run', async () => {
      const { engine } = make({ maxRepetitions: 1 }, () => sleep(50));
      engine.start();
      await advance(10);
      expect(engine.getSnapshot()).toMatchObject({ executing: true });
      await advance(100);
      const { lastRun } = engine.getSnapshot();
      expect(lastRun).toMatchObject({ index: 1, error: null });
      expect(lastRun!.finishedAt).not.toBeNull();
    });

    it('emits events for state changes and runs', async () => {
      const { engine } = make({ intervalMs: 100, maxRepetitions: 2 });
      const types: string[] = [];
      engine.subscribe((e) => types.push(e.type));
      engine.start();
      await advance(1000);

      expect(types).toContain('state');
      expect(types.filter((t) => t === 'run-start')).toHaveLength(2);
      expect(types.filter((t) => t === 'run-end')).toHaveLength(2);
    });

    it('unsubscribes', async () => {
      const { engine } = make({ maxRepetitions: 1 });
      const listener = jest.fn();
      engine.subscribe(listener)();
      engine.start();
      await advance(100);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('app lifecycle', () => {
    it('does not start new runs while backgrounded and cancels its timer', async () => {
      const { engine, runs } = make({ intervalMs: 1000 });
      engine.start();
      await advance(1500); // runs at 0 and 1000
      engine.notifyAppState('background');
      expect(jest.getTimerCount()).toBe(0);

      await advance(10_000);
      expect(runs).toHaveLength(2);
      expect(engine.getSnapshot().inBackground).toBe(true);
    });

    it('skips the overdue runs on return (default policy) and realigns to the schedule', async () => {
      const { engine, runs } = make({ intervalMs: 1000 });
      engine.start();
      await advance(1500);
      engine.notifyAppState('background');
      await advance(5000); // t=6500: slots 2..6 were overdue
      engine.notifyAppState('active');
      await advance(0);

      expect(runs).toEqual([0, 1000]); // nothing fires in a burst
      expect(engine.getSnapshot().skippedRuns).toBe(5);
      await advance(500); // next slot is 7000
      expect(runs).toEqual([0, 1000, 7000]);
    });

    it('can run the latest overdue slot once on return', async () => {
      const { engine, runs } = make({ intervalMs: 1000, missedRuns: 'run-once' });
      engine.start();
      await advance(1500);
      engine.notifyAppState('background');
      await advance(5000);
      engine.notifyAppState('active');
      await advance(0);

      expect(runs).toEqual([0, 1000, 6500]);
      expect(engine.getSnapshot().skippedRuns).toBe(4);
    });

    it('runs a single delayed start late when the app returns after it was due', async () => {
      const { engine, runs } = make({ startDelayMs: 5000 });
      engine.start();
      engine.notifyAppState('background');
      await advance(60_000);
      expect(runs).toEqual([]);

      engine.notifyAppState('active');
      await advance(0);
      expect(runs).toEqual([60_000]);
    });

    it('completes on return if the window ended while away, without running', async () => {
      const { engine, runs } = make({ intervalMs: 1000, durationMs: 3500 });
      engine.start();
      await advance(1500);
      engine.notifyAppState('background');
      await advance(10_000);
      engine.notifyAppState('active');
      await advance(0);

      expect(runs).toEqual([0, 1000]);
      expect(engine.getState()).toBe('COMPLETED');
    });

    it('in pause mode, freezes in the background and resumes on return', async () => {
      const { engine, runs } = make({ intervalMs: 1000, maxRepetitions: 3, backgroundBehavior: 'pause' });
      engine.start();
      await advance(1500);
      engine.notifyAppState('background');
      expect(engine.getState()).toBe('PAUSED');
      const frozen = engine.getSnapshot().countdownMs;

      await advance(100_000);
      expect(runs).toHaveLength(2);

      engine.notifyAppState('active');
      expect(engine.getState()).toBe('RUNNING');
      await advance(frozen!);
      expect(runs).toHaveLength(3);
      expect(engine.getSnapshot().skippedRuns).toBe(0);
    });

    it('does not resume a timer the user paused when the app returns', async () => {
      const { engine } = make({ intervalMs: 1000, backgroundBehavior: 'pause' });
      engine.start();
      await advance(100);
      engine.pause(); // user pause
      engine.notifyAppState('background');
      engine.notifyAppState('active');
      expect(engine.getState()).toBe('PAUSED');
    });

    it('ignores "inactive" (a transient state) and repeated notifications', async () => {
      const { engine, runs } = make({ intervalMs: 1000 });
      engine.start();
      await advance(100);
      engine.notifyAppState('inactive');
      engine.notifyAppState('active');
      await advance(1000);
      expect(runs).toHaveLength(2);
      expect(engine.getSnapshot().inBackground).toBe(false);
    });
  });

  describe('timer accuracy', () => {
    it('recomputes from the clock when a wake-up is late', async () => {
      const { engine, runs } = make({ intervalMs: 1000, maxRepetitions: 3 });
      engine.start();
      await advance(0);
      // Simulate a blocked JS thread: time jumps 1.4s without timers firing in between.
      jest.setSystemTime(T0 + 1400);
      await advance(0);
      await advance(1000);
      expect(runs.length).toBeGreaterThanOrEqual(2);
      expect(runs[1]).toBeGreaterThanOrEqual(1000);
    });

    it('handles very long delays (beyond the 32-bit setTimeout limit)', async () => {
      const day = 24 * 3600 * 1000;
      const { engine, runs } = make({ startDelayMs: 30 * day });
      engine.start();
      await advance(29 * day);
      expect(runs).toEqual([]);
      await advance(day);
      expect(runs).toHaveLength(1);
    });
  });

  describe('validation', () => {
    const bad = (config: Partial<TimerConfig>) => () => new TimerEngine(() => {}, config);

    it('rejects invalid configs', () => {
      expect(bad({ startDelayMs: -1 })).toThrow(RangeError);
      expect(bad({ durationMs: 0 })).toThrow(RangeError);
      expect(bad({ intervalMs: 0 })).toThrow(RangeError);
      expect(bad({ intervalMs: NaN })).toThrow(RangeError);
      expect(bad({ maxRepetitions: 0 })).toThrow(RangeError);
      expect(bad({ maxRepetitions: 1.5, intervalMs: 10 })).toThrow(RangeError);
      expect(bad({ maxRepetitions: 3 })).toThrow(/intervalMs/);
      expect(bad({ staleAfterMs: -5 })).toThrow(RangeError);
    });
  });
});

describe('formatCountdown', () => {
  it('formats m:ss and h:mm:ss, rounding up', () => {
    expect(formatCountdown(null)).toBe('--:--');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(59_000)).toBe('0:59');
    expect(formatCountdown(61_000)).toBe('1:01');
    expect(formatCountdown(3_600_000)).toBe('1:00:00');
    expect(formatCountdown(3_725_000)).toBe('1:02:05');
    expect(formatCountdown(-50)).toBe('0:00');
  });
});
