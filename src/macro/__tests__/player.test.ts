import {
  ClickEngine,
  ClickError,
  InAppClickAdapter,
  InAppTapRegistry,
  type AdapterContext,
  type ClickAdapter,
  type TapRequest,
} from '../../click';
import { EngineState } from '../../engine';
import { MacroPlayer, type Macro } from '..';
import { macroOf, tap, wait } from '../__fixtures__/helpers';

class FakeAndroid implements ClickAdapter {
  readonly platform = 'android' as const;
  readonly capabilities = {
    crossApp: true,
    supportsDuration: true,
    coordinateSpace: 'screen-pixels' as const,
    description: 'fake',
  };
  taps: { req: TapRequest; at: number }[] = [];
  failTimes = 0;

  async getAvailability() {
    return { available: true as const };
  }
  async tap(req: TapRequest, _ctx: AdapterContext) {
    this.taps.push({ req, at: Date.now() });
    if (this.failTimes > 0) {
      this.failTimes--;
      throw new ClickError('REJECTED', 'nope', { retryable: true });
    }
  }
}

const T0 = 5_000_000;

function setup(adapter: ClickAdapter = new FakeAndroid(), extra = {}) {
  const clicker = new ClickEngine(adapter, { minIntervalMs: 0, retryDelayMs: 0, ...extra });
  const player = new MacroPlayer({ clicker, screen: { width: 1080, height: 2400 } });
  return { adapter: adapter as FakeAndroid, clicker, player };
}

async function finish<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  promise.then(() => (done = true), () => (done = true));
  for (let i = 0; i < 20_000 && !done; i++) await jest.advanceTimersByTimeAsync(25);
  expect(done).toBe(true);
  return promise;
}

describe('MacroPlayer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
  });
  afterEach(() => jest.useRealTimers());

  it('plays steps in order with the recorded coordinates and tap durations', async () => {
    const { adapter, player } = setup();
    const macro = macroOf([tap('a', 100, 200, 0, 80), tap('b', 300, 400), tap('c', 500, 600, 0, 200)]);
    expect(player.start(macro).started).toBe(true);

    const result = await finish(player.whenDone());
    expect(result).toMatchObject({ status: 'completed', stepsExecuted: 3, totalSteps: 3 });
    expect(adapter.taps.map((t) => t.req)).toEqual([
      { x: 100, y: 200, durationMs: 80 },
      { x: 300, y: 400, durationMs: 50 },
      { x: 500, y: 600, durationMs: 200 },
    ]);
  });

  it('respects the delay between steps (and before the first one)', async () => {
    const { adapter, player } = setup();
    player.start(macroOf([tap('a', 1, 1, 1000), tap('b', 2, 2, 2500), tap('c', 3, 3, 500)]));
    await finish(player.whenDone());

    expect(adapter.taps.map((t) => t.at - T0)).toEqual([1000, 3500, 4000]);
  });

  it('plays a wait step as a pause', async () => {
    const { adapter, player } = setup();
    player.start(macroOf([tap('a', 1, 1), wait('w', 3000), tap('b', 2, 2, 500)]));
    await finish(player.whenDone());
    expect(adapter.taps.map((t) => t.at - T0)).toEqual([0, 3500]);
  });

  it('repeats the macro the configured number of times, with the gap between repeats', async () => {
    const { adapter, player } = setup();
    const macro = macroOf([tap('a', 1, 1), tap('b', 2, 2, 100)], { repeat: { count: 3, delayBetweenMs: 1000 } });
    player.start(macro);
    const result = await finish(player.whenDone());

    expect(result).toMatchObject({ status: 'completed', stepsExecuted: 6, totalSteps: 6 });
    // each round: a, then b 100 ms later, then 1000 ms gap before the next a
    expect(adapter.taps.map((t) => t.at - T0)).toEqual([0, 100, 1100, 1200, 2200, 2300]);
  });

  it('allows deliberate repeated taps on the same point (no accidental-repeat guard)', async () => {
    const { adapter, player } = setup(new FakeAndroid(), { duplicateWindowMs: 10_000 });
    player.start(macroOf([tap('a', 100, 100), tap('b', 100, 100), tap('c', 100, 100)]));
    const result = await finish(player.whenDone());

    expect(result.status).toBe('completed');
    expect(adapter.taps).toHaveLength(3);
  });

  describe('validation before playback', () => {
    it('plays nothing when the macro is invalid for this platform', () => {
      const { adapter, player } = setup();
      const iosMacro = macroOf([tap('a', 1, 1)], { platform: 'ios', coordinateSpace: 'window-points' });
      const { started, report } = player.start(iosMacro);

      expect(started).toBe(false);
      expect(report.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['PLATFORM_MISMATCH', 'COORDINATE_SPACE_MISMATCH']));
      expect(adapter.taps).toHaveLength(0);
    });

    it('refuses unsupported actions and out-of-bounds taps, naming the step', () => {
      const { player } = setup();
      const macro = macroOf([tap('ok', 1, 1), tap('far', 9999, 1), { id: 'sw', type: 'swipe', x: 1, y: 1, toX: 2, toY: 2, durationMs: 300, delayMs: 0 }]);
      const { started, report } = player.start(macro);

      expect(started).toBe(false);
      expect(report.issues.map((i) => [i.code, i.stepId])).toEqual([
        ['OUT_OF_BOUNDS', 'far'],
        ['UNSUPPORTED_ACTION', 'sw'],
      ]);
    });

    it('on iOS only plays taps that hit a control of this app', async () => {
      const registry = new InAppTapRegistry();
      const pressed = jest.fn();
      registry.register({ id: 'register', getBounds: () => ({ left: 0, top: 0, width: 100, height: 100 }), onPress: pressed });
      const clicker = new ClickEngine(new InAppClickAdapter(registry), { minIntervalMs: 0 });
      const player = new MacroPlayer({ clicker, hitTest: (x, y) => registry.hitTest(x, y) !== null });
      const iosMacro = (steps: Macro['steps']) => macroOf(steps, { platform: 'ios', coordinateSpace: 'window-points' });

      expect(player.start(iosMacro([tap('a', 500, 500)])).started).toBe(false); // another app's pixels

      expect(player.start(iosMacro([tap('a', 50, 50)])).started).toBe(true);
      const result = await finish(player.whenDone());
      expect(result.status).toBe('completed');
      expect(pressed).toHaveBeenCalledTimes(1);
    });

    it('does not start on an unsupported platform', () => {
      const unsupported: ClickAdapter = {
        platform: 'unsupported',
        capabilities: { crossApp: false, supportsDuration: false, coordinateSpace: 'window-points', description: '' },
        getAvailability: async () => ({ available: false, reason: 'no' }),
        tap: async () => {},
      };
      const player = new MacroPlayer({ clicker: new ClickEngine(unsupported) });
      expect(player.start(macroOf([tap('a', 1, 1)], { platform: 'any', coordinateSpace: 'window-points' })).started).toBe(false);
    });
  });

  describe('control', () => {
    const slow = () => macroOf([tap('a', 1, 1, 1000), tap('b', 2, 2, 1000), tap('c', 3, 3, 1000), tap('d', 4, 4, 1000)]);

    it('stops playback and plays nothing more', async () => {
      const { adapter, player } = setup();
      player.start(slow());
      await jest.advanceTimersByTimeAsync(1500); // a done
      expect(player.stop()).toBe(true);

      const result = await finish(player.whenDone());
      await jest.advanceTimersByTimeAsync(10_000);
      expect(result.status).toBe('stopped');
      expect(adapter.taps).toHaveLength(1);
    });

    it('pauses and resumes', async () => {
      const { adapter, player } = setup();
      player.start(slow());
      await jest.advanceTimersByTimeAsync(1500);
      expect(player.pause()).toBe(true);
      await jest.advanceTimersByTimeAsync(20_000);
      expect(adapter.taps).toHaveLength(1); // b would have run at 2000 ms but playback is paused
      const during = adapter.taps.length;
      await jest.advanceTimersByTimeAsync(20_000);
      expect(adapter.taps).toHaveLength(during);

      expect(player.resume()).toBe(true);
      const result = await finish(player.whenDone());
      expect(result).toMatchObject({ status: 'completed', stepsExecuted: 4 });
    });

    it('rejects a second start while playing', async () => {
      const { player } = setup();
      expect(player.start(slow()).started).toBe(true);
      const second = player.start(slow());
      expect(second.started).toBe(false);
      expect(second.report.issues.map((i) => i.code)).toContain('ALREADY_PLAYING');
      player.stop();
      await finish(player.whenDone());
    });

    it('reports progress', async () => {
      const { player } = setup();
      const seen: number[] = [];
      player.subscribe((p) => seen.push(p.completedSteps));
      player.start(macroOf([tap('a', 1, 1), tap('b', 2, 2, 100)], { repeat: { count: 2, delayBetweenMs: 0 } }));
      await finish(player.whenDone());

      expect(Math.max(...seen)).toBe(4);
      expect(player.getProgress()).toMatchObject({ state: EngineState.COMPLETED, completedSteps: 4, totalSteps: 4 });
    });
  });

  describe('failures', () => {
    it('fails and names the step when a click fails', async () => {
      const adapter = new FakeAndroid();
      adapter.failTimes = 99;
      const { player } = setup(adapter);
      player.start(macroOf([tap('first', 1, 1), tap('second', 2, 2)]));
      const result = await finish(player.whenDone());

      expect(result.status).toBe('failed');
      expect(result.failedStepId).toBe('first');
      expect(result.error).toBeInstanceOf(ClickError);
      expect(adapter.taps).toHaveLength(1); // the second step never ran
    });

    it('can retry a rejected click', async () => {
      const adapter = new FakeAndroid();
      adapter.failTimes = 1;
      const { player } = setup(adapter);
      player.start(macroOf([tap('a', 1, 1)]), { maxRetries: 2 });
      const result = await finish(player.whenDone());

      expect(result.status).toBe('completed');
      expect(adapter.taps).toHaveLength(2);
    });

    it('fails clearly when the click service is off', async () => {
      const adapter = new FakeAndroid();
      adapter.getAvailability = async () => ({ available: false as never, reason: 'service off' } as never);
      const { player } = setup(adapter);
      player.start(macroOf([tap('a', 1, 1)]));
      const result = await finish(player.whenDone());

      expect(result.status).toBe('failed');
      expect((result.error as ClickError).code).toBe('UNAVAILABLE');
    });
  });
});
