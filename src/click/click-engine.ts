import { ClickError, toClickError } from './errors';
import type {
  ClickAdapter,
  ClickEngineConfig,
  ClickOptions,
  ClickRequest,
  ClickResult,
  ClickVerifier,
  TapRequest,
} from './types';

export const DEFAULT_CLICK_CONFIG: ClickEngineConfig = {
  defaultDurationMs: 50,
  maxDurationMs: 5000,
  minIntervalMs: 300,
  duplicateWindowMs: 1000,
  duplicateRadius: 12,
  timeoutMs: 3000,
  maxRetries: 0,
  retryDelayMs: 250,
  retryOnTimeout: false,
  verifyTimeoutMs: 1500,
  verifyIntervalMs: 100,
};

function validateConfig(c: ClickEngineConfig) {
  const nonNegative: (keyof ClickEngineConfig)[] = [
    'minIntervalMs',
    'duplicateWindowMs',
    'duplicateRadius',
    'maxRetries',
    'retryDelayMs',
    'verifyTimeoutMs',
  ];
  const positive: (keyof ClickEngineConfig)[] = [
    'defaultDurationMs',
    'maxDurationMs',
    'timeoutMs',
    'verifyIntervalMs',
  ];
  for (const key of nonNegative) {
    const v = c[key] as number;
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`${key} must be >= 0, got ${v}`);
  }
  for (const key of positive) {
    const v = c[key] as number;
    if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${key} must be > 0, got ${v}`);
  }
  if (!Number.isInteger(c.maxRetries)) throw new RangeError('maxRetries must be an integer');
  if (c.defaultDurationMs > c.maxDurationMs) {
    throw new RangeError('defaultDurationMs must not exceed maxDurationMs');
  }
}

const cancelled = () => new ClickError('CANCELLED', 'Click was cancelled');

/** Sleeps `ms`, rejecting with CANCELLED if `signal` aborts first. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(cancelled());
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Safe, rate-limited clicking on top of a platform `ClickAdapter`.
 *
 * Guards against accidental repeats in three ways: only one click runs at a time, a click on
 * the same point within `duplicateWindowMs` is rejected, and `minIntervalMs` is enforced between
 * clicks. Retries happen only when the adapter says the tap definitely did not occur.
 */
export class ClickEngine {
  private readonly adapter: ClickAdapter;
  private readonly config: ClickEngineConfig;

  private busy = false;
  private lastDispatch: { x: number; y: number; at: number } | null = null;
  private lastEndedAt = -Infinity;

  constructor(adapter: ClickAdapter, config: Partial<ClickEngineConfig> = {}) {
    this.adapter = adapter;
    this.config = { ...DEFAULT_CLICK_CONFIG, ...config };
    validateConfig(this.config);
  }

  get capabilities() {
    return this.adapter.capabilities;
  }

  getAvailability() {
    return this.adapter.getAvailability();
  }

  /** Performs one click. Rejects with a `ClickError` on any failure; never leaves the engine busy. */
  async click(request: ClickRequest, options: ClickOptions = {}): Promise<ClickResult> {
    const tap = this.validate(request);
    const signal = options.signal ?? new AbortController().signal;
    if (signal.aborted) throw cancelled();

    // Both guards run synchronously, before the first await, so two calls cannot slip past.
    if (this.busy) throw new ClickError('DUPLICATE', 'Another click is already in progress');
    if (!options.allowRepeat && this.isRepeat(tap)) {
      throw new ClickError(
        'DUPLICATE',
        `Ignored repeated click at (${tap.x}, ${tap.y}) within ${this.config.duplicateWindowMs} ms`,
      );
    }
    this.busy = true;

    try {
      const availability = await this.adapter.getAvailability();
      if (!availability.available) throw new ClickError('UNAVAILABLE', availability.reason);

      const maxAttempts = this.config.maxRetries + 1;
      for (let attempt = 1; ; attempt++) {
        try {
          await this.waitForInterval(signal);
          this.lastDispatch = { x: tap.x, y: tap.y, at: Date.now() };
          try {
            await this.tapOnce(tap, signal);
          } finally {
            this.lastEndedAt = Date.now();
          }

          let verified: boolean | null = null;
          if (options.verify) {
            verified = await this.verify(options.verify, attempt, signal);
            if (!verified) {
              throw new ClickError(
                'VERIFICATION_FAILED',
                `Click at (${tap.x}, ${tap.y}) was not verified within ${this.config.verifyTimeoutMs} ms`,
                { retryable: true },
              );
            }
          }
          return { x: tap.x, y: tap.y, durationMs: tap.durationMs, attempts: attempt, verified };
        } catch (e) {
          const error = toClickError(e);
          if (!error.retryable || attempt >= maxAttempts) throw error;
          await sleep(this.config.retryDelayMs, signal);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private validate(request: ClickRequest): TapRequest {
    const { x, y } = request;
    const durationMs = request.durationMs ?? this.config.defaultDurationMs;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      throw new ClickError('INVALID_REQUEST', `Invalid coordinates (${x}, ${y})`);
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > this.config.maxDurationMs) {
      throw new ClickError(
        'INVALID_REQUEST',
        `durationMs must be between 1 and ${this.config.maxDurationMs}, got ${durationMs}`,
      );
    }
    return { x, y, durationMs };
  }

  private isRepeat(tap: TapRequest): boolean {
    const last = this.lastDispatch;
    if (!last || Date.now() - last.at >= this.config.duplicateWindowMs) return false;
    return Math.hypot(tap.x - last.x, tap.y - last.y) <= this.config.duplicateRadius;
  }

  private waitForInterval(signal: AbortSignal): Promise<void> {
    return sleep(this.lastEndedAt + this.config.minIntervalMs - Date.now(), signal);
  }

  private async tapOnce(tap: TapRequest, outer: AbortSignal): Promise<void> {
    const controller = new AbortController();
    let onOuterAbort: () => void = () => {};
    // Settles as soon as the caller cancels, even if the adapter ignores its signal.
    const cancellation = new Promise<never>((_, reject) => {
      onOuterAbort = () => {
        controller.abort();
        reject(cancelled());
      };
      outer.addEventListener('abort', onOuterAbort, { once: true });
    });
    cancellation.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const tapping = this.adapter.tap(tap, { signal: controller.signal });
      tapping.catch(() => {}); // a late rejection after a timeout must not become unhandled
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(
            new ClickError('TIMEOUT', `Click timed out after ${this.config.timeoutMs} ms`, {
              retryable: this.config.retryOnTimeout,
            }),
          );
        }, this.config.timeoutMs);
      });
      await Promise.race([tapping, timeout, cancellation]);
    } catch (e) {
      throw outer.aborted ? cancelled() : toClickError(e);
    } finally {
      clearTimeout(timer);
      outer.removeEventListener('abort', onOuterAbort);
    }
  }

  /** Polls the verifier until it passes or `verifyTimeoutMs` elapses. A throwing verifier counts as "no". */
  private async verify(verifier: ClickVerifier, attempt: number, signal: AbortSignal): Promise<boolean> {
    const deadline = Date.now() + this.config.verifyTimeoutMs;
    for (;;) {
      if (signal.aborted) throw cancelled();
      let ok = false;
      try {
        ok = await verifier({ attempt });
      } catch {
        ok = false;
      }
      if (ok) return true;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await sleep(Math.min(this.config.verifyIntervalMs, remaining), signal);
    }
  }
}
