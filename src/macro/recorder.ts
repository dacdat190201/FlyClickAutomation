import {
  DEFAULT_TAP_DURATION_MS,
  LIMITS,
  MACRO_SCHEMA_VERSION,
  defaultMacroEnv,
  isoNow,
  type Macro,
  type MacroCoordinateSpace,
  type MacroEnv,
  type MacroPlatform,
  type MacroStep,
} from './types';

/** An action reported by an input source (for example a touch overlay inside the app). */
export type RecordedEvent = {
  /** Only `tap` is recordable. Other types are refused, not silently turned into taps. */
  type: string;
  x: number;
  y: number;
  /** How long the finger stayed down. Defaults to 50 ms. */
  durationMs?: number;
  /** When the action started (epoch ms). Defaults to now. */
  at?: number;
};

export type RecordResult =
  | { ok: true; step: MacroStep }
  | { ok: false; reason: string };

export type RecorderOptions = {
  name: string;
  platform: MacroPlatform;
  coordinateSpace: MacroCoordinateSpace;
  /** Reject actions outside the screen. */
  screen?: { width: number; height: number };
  /** Count the time before the first action as its delay. Default false. */
  includeLeadingDelay?: boolean;
  env?: MacroEnv;
};

type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

/**
 * Turns a stream of supported actions into a macro: type, coordinates and the delay between
 * actions. It only records what an input source reports; it does not observe the screen itself
 * (neither Android nor iOS lets an app watch touches in other apps through the click adapters).
 */
export class MacroRecorder {
  private readonly options: RecorderOptions;
  private readonly env: MacroEnv;
  private state: RecorderState = 'idle';
  private steps: MacroStep[] = [];
  /** End of the previous action, or the point delays are measured from. `null` = first action has no delay. */
  private lastEndAt: number | null = null;

  constructor(options: RecorderOptions) {
    this.options = options;
    this.env = options.env ?? defaultMacroEnv;
  }

  get status(): RecorderState {
    return this.state;
  }

  get stepCount(): number {
    return this.steps.length;
  }

  start(): boolean {
    if (this.state !== 'idle') return false;
    this.state = 'recording';
    this.lastEndAt = this.options.includeLeadingDelay ? this.env.now() : null;
    return true;
  }

  pause(): boolean {
    if (this.state !== 'recording') return false;
    this.state = 'paused';
    return true;
  }

  /** Time spent paused is not recorded as a delay. */
  resume(): boolean {
    if (this.state !== 'paused') return false;
    this.state = 'recording';
    if (this.lastEndAt !== null || this.steps.length > 0 || this.options.includeLeadingDelay) {
      this.lastEndAt = this.env.now();
    }
    return true;
  }

  record(event: RecordedEvent): RecordResult {
    if (this.state !== 'recording') return { ok: false, reason: `Not recording (${this.state})` };
    if (event.type !== 'tap') return { ok: false, reason: `"${event.type}" actions cannot be recorded` };
    if (this.steps.length >= LIMITS.maxSteps) return { ok: false, reason: `Reached the limit of ${LIMITS.maxSteps} steps` };

    const { x, y } = event;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
      return { ok: false, reason: `Invalid coordinates (${x}, ${y})` };
    }
    const screen = this.options.screen;
    if (screen && (x > screen.width || y > screen.height)) {
      return { ok: false, reason: `(${x}, ${y}) is outside the ${screen.width}×${screen.height} screen` };
    }

    const durationMs = event.durationMs ?? DEFAULT_TAP_DURATION_MS;
    if (!Number.isFinite(durationMs) || durationMs < 1) return { ok: false, reason: `Invalid duration ${durationMs}` };

    const at = event.at ?? this.env.now();
    const delayMs =
      this.lastEndAt === null ? 0 : Math.min(LIMITS.maxDelayMs, Math.max(0, Math.round(at - this.lastEndAt)));
    this.lastEndAt = at + durationMs;

    const step: MacroStep = {
      id: this.env.newId('step'),
      type: 'tap',
      x,
      y,
      durationMs: Math.min(LIMITS.maxTapDurationMs, Math.round(durationMs)),
      delayMs,
    };
    this.steps.push(step);
    return { ok: true, step };
  }

  /** Removes the last recorded action (an accidental tap). */
  undoLast(): MacroStep | undefined {
    return this.steps.pop();
  }

  /** Ends the recording and returns the macro. */
  stop(): Macro {
    this.state = 'stopped';
    const now = isoNow(this.env);
    return {
      schemaVersion: MACRO_SCHEMA_VERSION,
      id: this.env.newId('macro'),
      name: this.options.name,
      createdAt: now,
      updatedAt: now,
      platform: this.options.platform,
      coordinateSpace: this.options.coordinateSpace,
      repeat: { count: 1, delayBetweenMs: 0 },
      steps: [...this.steps],
    };
  }
}
