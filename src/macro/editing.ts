import {
  LIMITS,
  defaultMacroEnv,
  isoNow,
  type Macro,
  type MacroEnv,
  type MacroRepeat,
  type MacroStep,
} from './types';
import { parseStep, validateStepFields } from './validation';

export type MacroEditErrorCode = 'STEP_NOT_FOUND' | 'INVALID_VALUE' | 'LIMIT_EXCEEDED';

export class MacroEditError extends Error {
  readonly code: MacroEditErrorCode;
  constructor(code: MacroEditErrorCode, message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'MacroEditError';
    this.code = code;
  }
}

/*
 * All editing functions are pure: they return a new macro and never change their input, so a UI
 * can keep an undo history by holding on to the previous value.
 */

const touch = (macro: Macro, env: MacroEnv, patch: Partial<Macro>): Macro => ({
  ...macro,
  ...patch,
  updatedAt: isoNow(env),
});

function indexOfStep(macro: Macro, stepId: string): number {
  const index = macro.steps.findIndex((s) => s.id === stepId);
  if (index < 0) throw new MacroEditError('STEP_NOT_FOUND', `No step with id "${stepId}"`);
  return index;
}

function assertValid(step: MacroStep, env: MacroEnv) {
  const errors = validateStepFields(step, env).filter((i) => i.level === 'error');
  if (errors.length > 0) throw new MacroEditError('INVALID_VALUE', errors.map((e) => e.message).join('; '));
}

export function deleteStep(macro: Macro, stepId: string, env: MacroEnv = defaultMacroEnv): Macro {
  const index = indexOfStep(macro, stepId);
  return touch(macro, env, { steps: macro.steps.filter((_, i) => i !== index) });
}

/** Copies a step (with a new id) right after the original. */
export function duplicateStep(
  macro: Macro,
  stepId: string,
  env: MacroEnv = defaultMacroEnv,
): { macro: Macro; stepId: string } {
  const index = indexOfStep(macro, stepId);
  if (macro.steps.length >= LIMITS.maxSteps) {
    throw new MacroEditError('LIMIT_EXCEEDED', `A macro can have at most ${LIMITS.maxSteps} steps`);
  }
  const copy: MacroStep = { ...macro.steps[index], id: env.newId('step') };
  const steps = [...macro.steps.slice(0, index + 1), copy, ...macro.steps.slice(index + 1)];
  return { macro: touch(macro, env, { steps }), stepId: copy.id };
}

/** The editable fields of a step. The type and id cannot change. */
export type StepPatch = Partial<{
  x: number;
  y: number;
  toX: number;
  toY: number;
  durationMs: number;
  delayMs: number;
  note: string;
}>;

export function updateStep(macro: Macro, stepId: string, patch: StepPatch, env: MacroEnv = defaultMacroEnv): Macro {
  const index = indexOfStep(macro, stepId);
  const current = macro.steps[index];
  const next = { ...current, ...patch, id: current.id, type: current.type } as MacroStep;
  assertValid(next, env);
  const steps = macro.steps.map((s, i) => (i === index ? next : s));
  return touch(macro, env, { steps });
}

/** `Omit` that keeps each member of the union (plain `Omit` would collapse it to the shared keys). */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type NewStep = DistributiveOmit<MacroStep, 'id'> & { id?: string };

/** Inserts a new step (its id is generated if missing). Appends when `index` is omitted. */
export function insertStep(
  macro: Macro,
  step: NewStep,
  index: number = macro.steps.length,
  env: MacroEnv = defaultMacroEnv,
): { macro: Macro; stepId: string } {
  if (macro.steps.length >= LIMITS.maxSteps) {
    throw new MacroEditError('LIMIT_EXCEEDED', `A macro can have at most ${LIMITS.maxSteps} steps`);
  }
  const used = new Set(macro.steps.map((s) => s.id));
  const parsed = parseStep(step, env, used);
  if (!parsed.step) {
    throw new MacroEditError('INVALID_VALUE', parsed.issues.map((i) => i.message).join('; '));
  }
  const at = Math.min(Math.max(0, index), macro.steps.length);
  const steps = [...macro.steps.slice(0, at), parsed.step, ...macro.steps.slice(at)];
  return { macro: touch(macro, env, { steps }), stepId: parsed.step.id };
}

export function moveStep(macro: Macro, stepId: string, toIndex: number, env: MacroEnv = defaultMacroEnv): Macro {
  const from = indexOfStep(macro, stepId);
  const to = Math.min(Math.max(0, toIndex), macro.steps.length - 1);
  const steps = [...macro.steps];
  const [moved] = steps.splice(from, 1);
  steps.splice(to, 0, moved);
  return touch(macro, env, { steps });
}

export function setRepeat(macro: Macro, patch: Partial<MacroRepeat>, env: MacroEnv = defaultMacroEnv): Macro {
  const repeat = { ...macro.repeat, ...patch };
  if (!Number.isInteger(repeat.count) || repeat.count < 1 || repeat.count > LIMITS.maxRepeat) {
    throw new MacroEditError('INVALID_VALUE', `Repeat count must be an integer between 1 and ${LIMITS.maxRepeat}`);
  }
  if (!Number.isFinite(repeat.delayBetweenMs) || repeat.delayBetweenMs < 0 || repeat.delayBetweenMs > LIMITS.maxDelayMs) {
    throw new MacroEditError('INVALID_VALUE', `Delay between repeats must be between 0 and ${LIMITS.maxDelayMs} ms`);
  }
  return touch(macro, env, { repeat });
}

export function renameMacro(macro: Macro, name: string, env: MacroEnv = defaultMacroEnv): Macro {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > LIMITS.maxNameLength) {
    throw new MacroEditError('INVALID_VALUE', `A name must be 1 to ${LIMITS.maxNameLength} characters`);
  }
  return touch(macro, env, { name: trimmed });
}

/** A copy of a whole macro with fresh ids, ready to be saved next to the original. */
export function cloneMacro(macro: Macro, name: string, env: MacroEnv = defaultMacroEnv): Macro {
  const now = isoNow(env);
  return {
    ...macro,
    id: env.newId('macro'),
    name,
    createdAt: now,
    updatedAt: now,
    repeat: { ...macro.repeat },
    steps: macro.steps.map((s) => ({ ...s, id: env.newId('step') })),
  };
}
