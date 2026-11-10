import type { ClickCapabilities } from '../click';
import {
  DEFAULT_SWIPE_DURATION_MS,
  DEFAULT_TAP_DURATION_MS,
  LIMITS,
  MACRO_SCHEMA_VERSION,
  defaultMacroEnv,
  isoNow,
  makeReport,
  type Issue,
  type Macro,
  type MacroCoordinateSpace,
  type MacroEnv,
  type MacroPlatform,
  type MacroStep,
  type Report,
} from './types';

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const PLATFORMS: readonly MacroPlatform[] = ['android', 'ios', 'any'];
const SPACES: readonly MacroCoordinateSpace[] = ['screen-pixels', 'window-points'];

class Reader {
  constructor(
    private readonly obj: Record<string, unknown>,
    readonly issues: Issue[],
    private readonly stepId?: string,
  ) {}

  error(code: string, message: string) {
    this.issues.push({ level: 'error', code, message, stepId: this.stepId });
  }

  /** Reads a finite number in [min, max]. Reports an error and returns undefined otherwise. */
  number(key: string, opts: { min: number; max: number; default?: number; integer?: boolean }): number | undefined {
    const value = this.obj[key];
    if (value === undefined && opts.default !== undefined) return opts.default;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.error('INVALID_VALUE', `"${key}" must be a number`);
      return undefined;
    }
    if (value < opts.min || value > opts.max || (opts.integer && !Number.isInteger(value))) {
      this.error('INVALID_VALUE', `"${key}" must be ${opts.integer ? 'an integer ' : ''}between ${opts.min} and ${opts.max}`);
      return undefined;
    }
    return value;
  }
}

/** Parses one step from untrusted input, copying only known fields. */
export function parseStep(raw: unknown, env: MacroEnv, usedIds: Set<string>): { step: MacroStep | null; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isObject(raw)) {
    return { step: null, issues: [{ level: 'error', code: 'INVALID_STEP', message: 'A step must be an object' }] };
  }

  let id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : env.newId('step');
  if (usedIds.has(id)) {
    issues.push({ level: 'error', code: 'DUPLICATE_STEP_ID', message: `Duplicate step id "${id}"`, stepId: id });
    id = env.newId('step');
  }
  usedIds.add(id);

  const r = new Reader(raw, issues, id);
  const delayMs = r.number('delayMs', { min: 0, max: LIMITS.maxDelayMs, default: 0 });

  let note: string | undefined;
  if (raw.note !== undefined) {
    if (typeof raw.note !== 'string') r.error('INVALID_VALUE', '"note" must be a string');
    else note = raw.note.slice(0, LIMITS.maxNoteLength);
  }
  const base = { id, delayMs: delayMs ?? 0, ...(note ? { note } : {}) };

  let step: MacroStep | null = null;
  switch (raw.type) {
    case 'tap': {
      const x = r.number('x', { min: 0, max: 1e6 });
      const y = r.number('y', { min: 0, max: 1e6 });
      const durationMs = r.number('durationMs', { min: 1, max: LIMITS.maxTapDurationMs, default: DEFAULT_TAP_DURATION_MS });
      if (x !== undefined && y !== undefined && durationMs !== undefined) step = { ...base, type: 'tap', x, y, durationMs };
      break;
    }
    case 'wait': {
      const durationMs = r.number('durationMs', { min: 1, max: LIMITS.maxDelayMs });
      if (durationMs !== undefined) step = { ...base, type: 'wait', durationMs };
      break;
    }
    case 'swipe': {
      const x = r.number('x', { min: 0, max: 1e6 });
      const y = r.number('y', { min: 0, max: 1e6 });
      const toX = r.number('toX', { min: 0, max: 1e6 });
      const toY = r.number('toY', { min: 0, max: 1e6 });
      const durationMs = r.number('durationMs', { min: 1, max: LIMITS.maxTapDurationMs, default: DEFAULT_SWIPE_DURATION_MS });
      if ([x, y, toX, toY, durationMs].every((v) => v !== undefined)) {
        step = { ...base, type: 'swipe', x: x!, y: y!, toX: toX!, toY: toY!, durationMs: durationMs! };
      }
      break;
    }
    default:
      r.error('UNKNOWN_STEP_TYPE', `Unknown step type ${JSON.stringify(raw.type)}`);
  }

  return { step: issues.some((i) => i.level === 'error') ? null : step, issues };
}

/** Field-level problems of an already typed step (used when editing). */
export function validateStepFields(step: MacroStep, env: MacroEnv = defaultMacroEnv): Issue[] {
  return parseStep(step, env, new Set()).issues;
}

/**
 * Parses and normalises untrusted input (an imported file, stored data) into a Macro.
 * Returns `macro: null` when anything is wrong enough to reject it.
 */
export function parseMacro(raw: unknown, env: MacroEnv = defaultMacroEnv): { macro: Macro | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const error = (code: string, message: string) => issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message });

  if (!isObject(raw)) {
    error('INVALID_MACRO', 'A macro must be an object');
    return { macro: null, issues };
  }

  if (raw.schemaVersion === undefined) warn('MISSING_VERSION', 'schemaVersion is missing; assuming 1');
  else if (typeof raw.schemaVersion !== 'number' || raw.schemaVersion > MACRO_SCHEMA_VERSION) {
    error('UNSUPPORTED_VERSION', `Unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)} (this app understands ${MACRO_SCHEMA_VERSION})`);
  }

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) error('INVALID_NAME', 'A macro needs a name');
  else if (name.length > LIMITS.maxNameLength) error('INVALID_NAME', `The name is longer than ${LIMITS.maxNameLength} characters`);

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : env.newId('macro');
  if (raw.id === undefined) warn('MISSING_ID', 'The macro had no id; one was generated');

  if (!PLATFORMS.includes(raw.platform as MacroPlatform)) error('INVALID_PLATFORM', `platform must be one of ${PLATFORMS.join(', ')}`);
  if (!SPACES.includes(raw.coordinateSpace as MacroCoordinateSpace)) {
    error('INVALID_COORDINATE_SPACE', `coordinateSpace must be one of ${SPACES.join(', ')}`);
  }

  let repeat = { count: 1, delayBetweenMs: 0 };
  if (raw.repeat !== undefined) {
    if (!isObject(raw.repeat)) error('INVALID_REPEAT', '"repeat" must be an object');
    else {
      const reader = new Reader(raw.repeat, issues);
      const count = reader.number('count', { min: 1, max: LIMITS.maxRepeat, default: 1, integer: true });
      const delayBetweenMs = reader.number('delayBetweenMs', { min: 0, max: LIMITS.maxDelayMs, default: 0 });
      if (count !== undefined && delayBetweenMs !== undefined) repeat = { count, delayBetweenMs };
    }
  }

  const steps: MacroStep[] = [];
  if (!Array.isArray(raw.steps)) error('INVALID_STEPS', '"steps" must be an array');
  else if (raw.steps.length > LIMITS.maxSteps) error('TOO_MANY_STEPS', `A macro can have at most ${LIMITS.maxSteps} steps`);
  else {
    const used = new Set<string>();
    raw.steps.forEach((s, i) => {
      const parsed = parseStep(s, env, used);
      for (const issue of parsed.issues) issues.push({ ...issue, message: `Step ${i + 1}: ${issue.message}` });
      if (parsed.step) steps.push(parsed.step);
    });
  }

  if (issues.some((i) => i.level === 'error')) return { macro: null, issues };

  const date = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : isoNow(env));
  return {
    macro: {
      schemaVersion: MACRO_SCHEMA_VERSION,
      id,
      name,
      createdAt: date(raw.createdAt),
      updatedAt: date(raw.updatedAt),
      platform: raw.platform as MacroPlatform,
      coordinateSpace: raw.coordinateSpace as MacroCoordinateSpace,
      repeat,
      steps,
    },
    issues,
  };
}

export type PlaybackContext = {
  /** `ClickEngine.platform` / `ClickAdapter.platform`. */
  platform: 'android' | 'ios-in-app' | 'unsupported';
  capabilities: ClickCapabilities;
  /** Screen size in the adapter's coordinate space, to catch out-of-bounds taps. */
  screen?: { width: number; height: number };
  /** For adapters that can only press the app's own controls: is there one at this point? */
  hitTest?: (x: number, y: number) => boolean;
};

/**
 * Checks that a macro can really be played here, before playing anything: platform,
 * coordinate space, supported actions, bounds and size. Errors block playback.
 */
export function validateForPlayback(macro: Macro, ctx: PlaybackContext): Report {
  const issues: Issue[] = [];
  const error = (code: string, message: string, stepId?: string) => issues.push({ level: 'error', code, message, stepId });
  const warn = (code: string, message: string, stepId?: string) => issues.push({ level: 'warning', code, message, stepId });

  if (ctx.platform === 'unsupported') {
    error('UNSUPPORTED_PLATFORM', 'This platform cannot perform clicks');
    return makeReport(issues);
  }

  const adapterPlatform = ctx.platform === 'android' ? 'android' : 'ios';
  if (macro.platform !== 'any' && macro.platform !== adapterPlatform) {
    error('PLATFORM_MISMATCH', `This macro is for ${macro.platform}, but this device runs ${adapterPlatform}`);
  }
  if (macro.coordinateSpace !== ctx.capabilities.coordinateSpace) {
    error(
      'COORDINATE_SPACE_MISMATCH',
      `This macro uses ${macro.coordinateSpace} coordinates, but this device expects ${ctx.capabilities.coordinateSpace}`,
    );
  }

  if (macro.steps.length === 0) error('EMPTY_MACRO', 'The macro has no steps');
  if (macro.steps.length * macro.repeat.count > LIMITS.maxTotalSteps) {
    error('TOO_LARGE', `Steps × repeats exceeds ${LIMITS.maxTotalSteps}`);
  }

  for (const step of macro.steps) {
    if (step.type === 'swipe') {
      error('UNSUPPORTED_ACTION', 'Swipe is not supported by any click adapter yet', step.id);
      continue;
    }
    if (step.type !== 'tap') continue;

    if (ctx.screen && (step.x > ctx.screen.width || step.y > ctx.screen.height)) {
      error('OUT_OF_BOUNDS', `(${step.x}, ${step.y}) is outside the ${ctx.screen.width}×${ctx.screen.height} screen`, step.id);
    }
    if (!ctx.capabilities.crossApp) {
      if (!ctx.hitTest) warn('UNVERIFIED_TARGET', 'Cannot check that a control of this app exists at this point', step.id);
      else if (!ctx.hitTest(step.x, step.y)) {
        error('NO_CONTROL_AT_POINT', `No control of this app at (${step.x}, ${step.y}); other apps cannot be tapped on this platform`, step.id);
      }
    }
    if (!ctx.capabilities.supportsDuration && step.durationMs !== DEFAULT_TAP_DURATION_MS) {
      warn('DURATION_IGNORED', 'This platform ignores the tap duration', step.id);
    }
  }

  return makeReport(issues);
}
