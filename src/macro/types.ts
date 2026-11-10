/**
 * Macro data model. Plain JSON, versioned, and independent of any UI or native code.
 */

export const MACRO_SCHEMA_VERSION = 1;
export const MACRO_FILE_FORMAT = 'flyclick-macros';

export const LIMITS = {
  maxSteps: 5000,
  maxRepeat: 100_000,
  /** Steps × repeats that one playback may expand to. */
  maxTotalSteps: 100_000,
  maxDelayMs: 3_600_000,
  maxTapDurationMs: 5000,
  maxNameLength: 100,
  maxNoteLength: 500,
  maxImportBytes: 5_000_000,
} as const;

export const DEFAULT_TAP_DURATION_MS = 50;
export const DEFAULT_SWIPE_DURATION_MS = 300;

/** The platform a macro was recorded for. `any` skips the platform check (coordinates still must match). */
export type MacroPlatform = 'android' | 'ios' | 'any';

/** What x/y mean: physical screen pixels (Android) or React Native window points (iOS, in-app). */
export type MacroCoordinateSpace = 'screen-pixels' | 'window-points';

type StepBase = {
  /** Stable id inside the macro, used for editing. */
  id: string;
  /** Time to wait before this step, counted from the end of the previous one. */
  delayMs: number;
  note?: string;
};

export type TapStep = StepBase & { type: 'tap'; x: number; y: number; durationMs: number };
export type WaitStep = StepBase & { type: 'wait'; durationMs: number };
/**
 * Part of the format so macros can describe it, but NO platform adapter can perform swipes yet:
 * playback validation rejects it.
 */
export type SwipeStep = StepBase & {
  type: 'swipe';
  x: number;
  y: number;
  toX: number;
  toY: number;
  durationMs: number;
};

export type MacroStep = TapStep | WaitStep | SwipeStep;
export type MacroStepType = MacroStep['type'];

export type MacroRepeat = {
  /** How many times the whole sequence is played. */
  count: number;
  /** Pause between two repetitions (in addition to the first step's own delay). */
  delayBetweenMs: number;
};

export type Macro = {
  schemaVersion: typeof MACRO_SCHEMA_VERSION;
  id: string;
  name: string;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
  platform: MacroPlatform;
  coordinateSpace: MacroCoordinateSpace;
  repeat: MacroRepeat;
  steps: MacroStep[];
};

/** The file written by export and read by import. */
export type MacroFile = {
  format: typeof MACRO_FILE_FORMAT;
  schemaVersion: typeof MACRO_SCHEMA_VERSION;
  exportedAt: string;
  macros: Macro[];
};

export type Issue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  stepId?: string;
};

export type Report = {
  /** True when there are no errors (warnings allowed). */
  ok: boolean;
  issues: Issue[];
};

export const makeReport = (issues: Issue[]): Report => ({
  ok: !issues.some((i) => i.level === 'error'),
  issues,
});

/** Clock and id source, injectable for tests. */
export type MacroEnv = {
  now(): number;
  newId(prefix: string): string;
};

let counter = 0;
export const defaultMacroEnv: MacroEnv = {
  now: () => Date.now(),
  newId: (prefix) => {
    counter = (counter + 1) % 1_000_000;
    return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  },
};

export const isoNow = (env: MacroEnv) => new Date(env.now()).toISOString();
