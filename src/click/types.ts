/**
 * Click Engine types. Core files in src/click are pure TypeScript (no React, no native imports),
 * except `native/android-native.ts`, which is the only place that touches the native module.
 */

export type Rect = { left: number; top: number; width: number; height: number };

/** A tap the engine hands to an adapter. All fields are validated before reaching the adapter. */
export type TapRequest = {
  x: number;
  y: number;
  /** How long the finger stays down, in ms. */
  durationMs: number;
};

export type AdapterContext = {
  /** Aborted on timeout or cancellation. Adapters should stop waiting for the platform promptly. */
  signal: AbortSignal;
};

export type ClickAvailability =
  | { available: true }
  | {
      available: false;
      reason: string;
      /** Something the user can do to make the adapter available. */
      action?: 'enable-accessibility-service';
    };

/**
 * `window-points`: React Native layout units inside this app's window.
 * `screen-pixels`: physical pixels of the whole screen (Android accessibility gestures).
 */
export type CoordinateSpace = 'window-points' | 'screen-pixels';

export type ClickCapabilities = {
  /** Can the adapter tap inside other apps? Only true where the OS really allows it. */
  crossApp: boolean;
  /** Is `durationMs` actually applied? When false the adapter ignores it. */
  supportsDuration: boolean;
  coordinateSpace: CoordinateSpace;
  /** Human-readable summary of what this adapter can and cannot do. */
  description: string;
};

/** Platform boundary. Implementations live in src/click/adapters. */
export interface ClickAdapter {
  readonly platform: 'android' | 'ios-in-app' | 'unsupported';
  readonly capabilities: ClickCapabilities;
  getAvailability(): Promise<ClickAvailability>;
  /**
   * Resolves only once the tap has been performed. Throw a `ClickError` otherwise:
   * `retryable: true` ONLY when the tap definitely did not happen.
   */
  tap(request: TapRequest, context: AdapterContext): Promise<void>;
}

export type ClickRequest = {
  x: number;
  y: number;
  /** Defaults to `config.defaultDurationMs`. */
  durationMs?: number;
};

export type VerifyContext = { attempt: number };

/** Returns true once the click had the expected effect (e.g. OCR sees the success text). */
export type ClickVerifier = (context: VerifyContext) => boolean | Promise<boolean>;

export type ClickOptions = {
  /** Checked after every tap; the click only counts as done when it returns true. */
  verify?: ClickVerifier;
  /** Skip the repeated-click guard for this call (an intentional double tap). */
  allowRepeat?: boolean;
  signal?: AbortSignal;
};

export type ClickResult = {
  x: number;
  y: number;
  durationMs: number;
  attempts: number;
  /** `null` when no verifier was supplied (the result was not checked). */
  verified: boolean | null;
};

export type ClickEngineConfig = {
  /** Tap duration used when a request does not set one. Default 50. */
  defaultDurationMs: number;
  /** Longest tap duration accepted. Default 5000. */
  maxDurationMs: number;
  /** Minimum gap between the end of one click and the start of the next. Default 300. */
  minIntervalMs: number;
  /** A click on (nearly) the same point within this window is rejected as accidental. Default 1000. */
  duplicateWindowMs: number;
  /** "Same point" tolerance, in the adapter's coordinate space. Default 12. */
  duplicateRadius: number;
  /** Per-attempt time limit for the adapter. Default 3000. */
  timeoutMs: number;
  /** Extra attempts after a retryable failure. Default 0. */
  maxRetries: number;
  /** Wait before a retry. Default 250. */
  retryDelayMs: number;
  /**
   * Retry after a timeout. Off by default: after a timeout we do not know whether the tap
   * landed, so retrying could click twice.
   */
  retryOnTimeout: boolean;
  /** How long to keep polling the verifier. Default 1500. */
  verifyTimeoutMs: number;
  /** Poll period of the verifier. Default 100. */
  verifyIntervalMs: number;
};
