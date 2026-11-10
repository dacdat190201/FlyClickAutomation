import {
  ClickEngine,
  ClickError,
  type AdapterContext,
  type ClickAdapter,
  type ClickAvailability,
  type ClickEngineConfig,
  type ClickErrorCode,
  type TapRequest,
} from '..';

type TapHandler = (req: TapRequest, ctx: AdapterContext, call: number) => Promise<void> | void;

/** Scriptable adapter that records every tap with the time it started. */
class FakeAdapter implements ClickAdapter {
  readonly platform = 'android' as const;
  readonly capabilities = {
    crossApp: true,
    supportsDuration: true,
    coordinateSpace: 'screen-pixels' as const,
    description: 'fake',
  };
  taps: { req: TapRequest; at: number; signal: AbortSignal }[] = [];
  availability: ClickAvailability = { available: true };

  constructor(private handler: TapHandler = () => {}) {}

  async getAvailability() {
    return this.availability;
  }

  async tap(req: TapRequest, ctx: AdapterContext) {
    this.taps.push({ req, at: Date.now(), signal: ctx.signal });
    await this.handler(req, ctx, this.taps.length);
  }
}

const never = () => new Promise<void>(() => {});
const rejectedOnce = (times: number): TapHandler => (_r, _c, call) => {
  if (call <= times) throw new ClickError('REJECTED', 'nope', { retryable: true });
};

async function codeOf(promise: Promise<unknown>): Promise<ClickErrorCode | 'resolved'> {
  try {
    await promise;
    return 'resolved';
  } catch (e) {
    return e instanceof ClickError ? e.code : (`not-click-error:${e}` as ClickErrorCode);
  }
}

function setup(handler?: TapHandler, config: Partial<ClickEngineConfig> = {}) {
  const adapter = new FakeAdapter(handler);
  // Intervals default to 0 here so each test only sees the behaviour it targets.
  const engine = new ClickEngine(adapter, { minIntervalMs: 0, duplicateWindowMs: 0, ...config });
  return { adapter, engine };
}

describe('ClickEngine', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('requests', () => {
    it('passes coordinates and the default tap duration to the adapter', async () => {
      const { adapter, engine } = setup();
      const result = await engine.click({ x: 120, y: 340 });

      expect(adapter.taps[0].req).toEqual({ x: 120, y: 340, durationMs: 50 });
      expect(result).toEqual({ x: 120, y: 340, durationMs: 50, attempts: 1, verified: null });
    });

    it('supports a configurable tap duration (e.g. long press)', async () => {
      const { adapter, engine } = setup();
      await engine.click({ x: 1, y: 1, durationMs: 800 });
      expect(adapter.taps[0].req.durationMs).toBe(800);
    });

    it('uses the configured default duration', async () => {
      const { adapter, engine } = setup(undefined, { defaultDurationMs: 120 });
      await engine.click({ x: 1, y: 1 });
      expect(adapter.taps[0].req.durationMs).toBe(120);
    });

    it.each([
      [{ x: NaN, y: 1 }],
      [{ x: 1, y: Infinity }],
      [{ x: -1, y: 5 }],
      [{ x: 5, y: -1 }],
      [{ x: 1, y: 1, durationMs: 0 }],
      [{ x: 1, y: 1, durationMs: -10 }],
      [{ x: 1, y: 1, durationMs: 5001 }],
      [{ x: 1, y: 1, durationMs: NaN }],
    ])('rejects invalid request %j without calling the adapter', async (request) => {
      const { adapter, engine } = setup();
      expect(await codeOf(engine.click(request))).toBe('INVALID_REQUEST');
      expect(adapter.taps).toHaveLength(0);
    });

    it('validates config', () => {
      const adapter = new FakeAdapter();
      expect(() => new ClickEngine(adapter, { timeoutMs: 0 })).toThrow(RangeError);
      expect(() => new ClickEngine(adapter, { minIntervalMs: -1 })).toThrow(RangeError);
      expect(() => new ClickEngine(adapter, { maxRetries: 1.5 })).toThrow(RangeError);
      expect(() => new ClickEngine(adapter, { defaultDurationMs: 9000 })).toThrow(RangeError);
    });
  });

  describe('availability', () => {
    it('fails with UNAVAILABLE and never taps when the adapter is not available', async () => {
      const { adapter, engine } = setup();
      adapter.availability = { available: false, reason: 'service off' };
      const error = await engine.click({ x: 1, y: 1 }).catch((e) => e);

      expect(error).toBeInstanceOf(ClickError);
      expect(error.code).toBe('UNAVAILABLE');
      expect(error.message).toBe('service off');
      expect(adapter.taps).toHaveLength(0);
    });
  });

  describe('click interval', () => {
    it('waits minIntervalMs between the end of one click and the start of the next', async () => {
      const { adapter, engine } = setup(undefined, { minIntervalMs: 500 });
      await engine.click({ x: 10, y: 10 });

      const second = engine.click({ x: 300, y: 300 });
      await jest.advanceTimersByTimeAsync(499);
      expect(adapter.taps).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      await second;

      expect(adapter.taps).toHaveLength(2);
      expect(adapter.taps[1].at - adapter.taps[0].at).toBeGreaterThanOrEqual(500);
    });

    it('does not delay the very first click', async () => {
      const { adapter, engine } = setup(undefined, { minIntervalMs: 10_000 });
      await engine.click({ x: 1, y: 1 });
      expect(adapter.taps).toHaveLength(1);
    });
  });

  describe('accidental repeats', () => {
    it('rejects a second click on the same point inside the window', async () => {
      const { adapter, engine } = setup(undefined, { duplicateWindowMs: 1000 });
      await engine.click({ x: 100, y: 100 });

      expect(await codeOf(engine.click({ x: 100, y: 100 }))).toBe('DUPLICATE');
      expect(await codeOf(engine.click({ x: 105, y: 96 }))).toBe('DUPLICATE'); // within radius
      expect(adapter.taps).toHaveLength(1);
    });

    it('allows a different point', async () => {
      const { adapter, engine } = setup(undefined, { duplicateWindowMs: 1000 });
      await engine.click({ x: 100, y: 100 });
      await engine.click({ x: 400, y: 100 });
      expect(adapter.taps).toHaveLength(2);
    });

    it('allows the same point once the window has passed', async () => {
      const { adapter, engine } = setup(undefined, { duplicateWindowMs: 1000 });
      await engine.click({ x: 100, y: 100 });
      await jest.advanceTimersByTimeAsync(1000);
      await engine.click({ x: 100, y: 100 });
      expect(adapter.taps).toHaveLength(2);
    });

    it('lets the caller opt in to an intentional repeat', async () => {
      const { adapter, engine } = setup(undefined, { duplicateWindowMs: 1000 });
      await engine.click({ x: 100, y: 100 });
      await engine.click({ x: 100, y: 100 }, { allowRepeat: true });
      expect(adapter.taps).toHaveLength(2);
    });

    it('rejects a click while another is still running', async () => {
      let finish: () => void = () => {};
      const { adapter, engine } = setup(() => new Promise<void>((r) => (finish = r)));

      const first = engine.click({ x: 1, y: 1 });
      await jest.advanceTimersByTimeAsync(0);
      expect(await codeOf(engine.click({ x: 500, y: 500 }))).toBe('DUPLICATE');

      finish();
      await first;
      expect(adapter.taps).toHaveLength(1);
    });

    it('two simultaneous calls start only one tap', async () => {
      const { adapter, engine } = setup();
      const results = await Promise.allSettled([
        engine.click({ x: 1, y: 1 }),
        engine.click({ x: 1, y: 1 }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect(adapter.taps).toHaveLength(1);
    });

    it('releases the engine after a failure', async () => {
      const { engine } = setup((_r, _c, call) => {
        if (call === 1) throw new Error('boom');
      });
      expect(await codeOf(engine.click({ x: 1, y: 1 }))).toBe('ADAPTER_ERROR');
      expect(await codeOf(engine.click({ x: 2, y: 2 }))).toBe('resolved');
    });
  });

  describe('timeout', () => {
    it('fails with TIMEOUT and aborts the adapter signal', async () => {
      const { adapter, engine } = setup(never, { timeoutMs: 1000 });
      const result = codeOf(engine.click({ x: 1, y: 1 }));
      await jest.advanceTimersByTimeAsync(1000);

      expect(await result).toBe('TIMEOUT');
      expect(adapter.taps[0].signal.aborted).toBe(true);
    });

    it('does not retry a timeout by default (the tap may have landed)', async () => {
      const { adapter, engine } = setup(never, { timeoutMs: 100, maxRetries: 3 });
      const result = codeOf(engine.click({ x: 1, y: 1 }));
      await jest.advanceTimersByTimeAsync(1000);

      expect(await result).toBe('TIMEOUT');
      expect(adapter.taps).toHaveLength(1);
    });

    it('retries a timeout when retryOnTimeout is enabled', async () => {
      const { adapter, engine } = setup(
        (_r, _c, call) => (call === 1 ? never() : undefined),
        { timeoutMs: 100, maxRetries: 1, retryOnTimeout: true, retryDelayMs: 0 },
      );
      const result = engine.click({ x: 1, y: 1 });
      await jest.advanceTimersByTimeAsync(200);

      expect((await result).attempts).toBe(2);
      expect(adapter.taps).toHaveLength(2);
    });

    it('does not leave timers behind after a normal click', async () => {
      const { engine } = setup(undefined, { timeoutMs: 5000 });
      await engine.click({ x: 1, y: 1 });
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('retry', () => {
    it('retries a retryable failure and reports the attempt count', async () => {
      const { adapter, engine } = setup(rejectedOnce(2), { maxRetries: 2, retryDelayMs: 0 });
      const result = await engine.click({ x: 1, y: 1 });

      expect(result.attempts).toBe(3);
      expect(adapter.taps).toHaveLength(3);
    });

    it('gives up after maxRetries and throws the last error', async () => {
      const { adapter, engine } = setup(rejectedOnce(99), { maxRetries: 2, retryDelayMs: 0 });
      expect(await codeOf(engine.click({ x: 1, y: 1 }))).toBe('REJECTED');
      expect(adapter.taps).toHaveLength(3);
    });

    it('does not retry by default', async () => {
      const { adapter, engine } = setup(rejectedOnce(1));
      expect(await codeOf(engine.click({ x: 1, y: 1 }))).toBe('REJECTED');
      expect(adapter.taps).toHaveLength(1);
    });

    it('never retries a non-retryable error (unknown outcome)', async () => {
      const { adapter, engine } = setup(
        () => {
          throw new Error('native crashed');
        },
        { maxRetries: 5, retryDelayMs: 0 },
      );
      expect(await codeOf(engine.click({ x: 1, y: 1 }))).toBe('ADAPTER_ERROR');
      expect(adapter.taps).toHaveLength(1);
    });

    it('waits retryDelayMs between attempts', async () => {
      const { adapter, engine } = setup(rejectedOnce(1), { maxRetries: 1, retryDelayMs: 400 });
      const result = engine.click({ x: 1, y: 1 });

      await jest.advanceTimersByTimeAsync(399);
      expect(adapter.taps).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1);
      await result;
      expect(adapter.taps).toHaveLength(2);
    });

    it('does not trip the repeat guard on its own retries', async () => {
      const { engine } = setup(rejectedOnce(1), {
        maxRetries: 1,
        retryDelayMs: 0,
        duplicateWindowMs: 10_000,
      });
      await expect(engine.click({ x: 1, y: 1 })).resolves.toMatchObject({ attempts: 2 });
    });
  });

  describe('verification', () => {
    it('reports verified: true when the verifier passes', async () => {
      const { engine } = setup();
      const result = await engine.click({ x: 1, y: 1 }, { verify: () => true });
      expect(result.verified).toBe(true);
    });

    it('polls until the verifier passes', async () => {
      const { engine } = setup(undefined, { verifyIntervalMs: 100, verifyTimeoutMs: 2000 });
      const verify = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);

      const result = engine.click({ x: 1, y: 1 }, { verify });
      await jest.advanceTimersByTimeAsync(300);

      expect((await result).verified).toBe(true);
      expect(verify).toHaveBeenCalledTimes(3);
    });

    it('fails with VERIFICATION_FAILED when the effect never shows up', async () => {
      const { adapter, engine } = setup(undefined, { verifyIntervalMs: 100, verifyTimeoutMs: 500 });
      const result = codeOf(engine.click({ x: 1, y: 1 }, { verify: () => false }));
      await jest.advanceTimersByTimeAsync(600);

      expect(await result).toBe('VERIFICATION_FAILED');
      expect(adapter.taps).toHaveLength(1);
    });

    it('treats a throwing verifier as not verified', async () => {
      const { engine } = setup(undefined, { verifyIntervalMs: 50, verifyTimeoutMs: 100 });
      const result = codeOf(
        engine.click(
          { x: 1, y: 1 },
          {
            verify: () => {
              throw new Error('ocr crashed');
            },
          },
        ),
      );
      await jest.advanceTimersByTimeAsync(200);
      expect(await result).toBe('VERIFICATION_FAILED');
    });

    it('taps again after a failed verification when retries are allowed', async () => {
      const { adapter, engine } = setup(undefined, {
        maxRetries: 1,
        retryDelayMs: 0,
        verifyIntervalMs: 10,
        verifyTimeoutMs: 20,
      });
      const verify = jest.fn(({ attempt }: { attempt: number }) => attempt === 2);

      const result = engine.click({ x: 1, y: 1 }, { verify });
      await jest.advanceTimersByTimeAsync(100);

      expect(await result).toMatchObject({ attempts: 2, verified: true });
      expect(adapter.taps).toHaveLength(2);
    });

    it('does not continue (resolve) before verification completes', async () => {
      const { engine } = setup(undefined, { verifyIntervalMs: 100, verifyTimeoutMs: 1000 });
      let ready = false;
      let resolved = false;
      const result = engine.click({ x: 1, y: 1 }, { verify: () => ready }).then(() => (resolved = true));

      await jest.advanceTimersByTimeAsync(250);
      expect(resolved).toBe(false);
      ready = true;
      await jest.advanceTimersByTimeAsync(100);
      await result;
      expect(resolved).toBe(true);
    });
  });

  describe('cancellation', () => {
    it('rejects immediately when already aborted', async () => {
      const { adapter, engine } = setup();
      const controller = new AbortController();
      controller.abort();
      expect(await codeOf(engine.click({ x: 1, y: 1 }, { signal: controller.signal }))).toBe('CANCELLED');
      expect(adapter.taps).toHaveLength(0);
    });

    it('cancels while waiting for the click interval', async () => {
      const { adapter, engine } = setup(undefined, { minIntervalMs: 5000 });
      await engine.click({ x: 1, y: 1 });

      const controller = new AbortController();
      const second = codeOf(engine.click({ x: 300, y: 300 }, { signal: controller.signal }));
      await jest.advanceTimersByTimeAsync(100);
      controller.abort();

      expect(await second).toBe('CANCELLED');
      expect(adapter.taps).toHaveLength(1);
    });

    it('cancels a tap in flight and aborts the adapter signal', async () => {
      const { adapter, engine } = setup(never);
      const controller = new AbortController();
      const result = codeOf(engine.click({ x: 1, y: 1 }, { signal: controller.signal }));
      await jest.advanceTimersByTimeAsync(10);
      controller.abort();

      expect(await result).toBe('CANCELLED');
      expect(adapter.taps[0].signal.aborted).toBe(true);
    });

    it('cancels while verifying', async () => {
      const { engine } = setup(undefined, { verifyTimeoutMs: 10_000 });
      const controller = new AbortController();
      const result = codeOf(
        engine.click({ x: 1, y: 1 }, { verify: () => false, signal: controller.signal }),
      );
      await jest.advanceTimersByTimeAsync(250);
      controller.abort();
      expect(await result).toBe('CANCELLED');
    });
  });
});
