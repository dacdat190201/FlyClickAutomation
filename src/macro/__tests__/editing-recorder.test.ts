import {
  MacroEditError,
  MacroRecorder,
  cloneMacro,
  deleteStep,
  duplicateStep,
  insertStep,
  moveStep,
  renameMacro,
  setRepeat,
  updateStep,
} from '..';
import { macroOf, tap, testEnv, wait } from '../__fixtures__/helpers';

describe('editing', () => {
  const env = testEnv();
  const base = () => macroOf([tap('a', 10, 10, 100), tap('b', 20, 20, 200), wait('c', 300)]);
  const ids = (m: { steps: { id: string }[] }) => m.steps.map((s) => s.id);

  it('deletes a step', () => {
    expect(ids(deleteStep(base(), 'b', env))).toEqual(['a', 'c']);
  });

  it('duplicates a step right after the original, with a new id', () => {
    const { macro, stepId } = duplicateStep(base(), 'a', env);
    expect(ids(macro)).toEqual(['a', stepId, 'b', 'c']);
    expect(stepId).not.toBe('a');
    expect(macro.steps[1]).toMatchObject({ type: 'tap', x: 10, y: 10, delayMs: 100 });
  });

  it('updates editable fields of a step', () => {
    const macro = updateStep(base(), 'a', { x: 99, delayMs: 5, note: 'press register' }, env);
    expect(macro.steps[0]).toMatchObject({ id: 'a', type: 'tap', x: 99, y: 10, delayMs: 5, note: 'press register' });
  });

  it('never changes the id or type through a patch', () => {
    const macro = updateStep(base(), 'a', { id: 'zzz', type: 'wait' } as never, env);
    expect(macro.steps[0]).toMatchObject({ id: 'a', type: 'tap' });
  });

  it('rejects invalid values and unknown steps', () => {
    expect(() => updateStep(base(), 'a', { x: -1 }, env)).toThrow(MacroEditError);
    expect(() => updateStep(base(), 'a', { durationMs: 0 }, env)).toThrow(/durationMs/);
    expect(() => updateStep(base(), 'nope', { x: 1 }, env)).toThrow(/No step/);
    expect(() => deleteStep(base(), 'nope', env)).toThrow(MacroEditError);
    expect(() => duplicateStep(base(), 'nope', env)).toThrow(MacroEditError);
  });

  it('inserts a step at a position, or at the end', () => {
    const first = insertStep(base(), { type: 'tap', x: 1, y: 1, durationMs: 50, delayMs: 0 }, 1, env);
    expect(first.macro.steps[1].id).toBe(first.stepId);
    expect(ids(first.macro)).toHaveLength(4);
    const last = insertStep(base(), { type: 'wait', durationMs: 100, delayMs: 0 }, undefined, env);
    expect(last.macro.steps[3].id).toBe(last.stepId);
    expect(() => insertStep(base(), { type: 'tap', x: -1, y: 1, durationMs: 50, delayMs: 0 }, 0, env)).toThrow(MacroEditError);
  });

  it('moves a step', () => {
    expect(ids(moveStep(base(), 'a', 2, env))).toEqual(['b', 'c', 'a']);
    expect(ids(moveStep(base(), 'c', 0, env))).toEqual(['c', 'a', 'b']);
    expect(ids(moveStep(base(), 'a', 99, env))).toEqual(['b', 'c', 'a']); // clamped
  });

  it('configures the repeat count', () => {
    expect(setRepeat(base(), { count: 5 }, env).repeat).toEqual({ count: 5, delayBetweenMs: 0 });
    expect(setRepeat(base(), { delayBetweenMs: 250 }, env).repeat.delayBetweenMs).toBe(250);
    expect(() => setRepeat(base(), { count: 0 }, env)).toThrow(MacroEditError);
    expect(() => setRepeat(base(), { count: 2.5 }, env)).toThrow(MacroEditError);
    expect(() => setRepeat(base(), { delayBetweenMs: -1 }, env)).toThrow(MacroEditError);
  });

  it('renames', () => {
    expect(renameMacro(base(), '  New name ', env).name).toBe('New name');
    expect(() => renameMacro(base(), '   ', env)).toThrow(MacroEditError);
  });

  it('is pure: the original is never changed, and updatedAt moves forward', () => {
    const original = base();
    const snapshot = JSON.stringify(original);
    const e = testEnv(Date.UTC(2027, 0, 1));
    const edited = deleteStep(original, 'a', e);

    expect(JSON.stringify(original)).toBe(snapshot);
    expect(edited.updatedAt).toBe('2027-01-01T00:00:00.000Z');
    expect(edited).not.toBe(original);
  });

  it('clones a macro with fresh ids for the macro and every step', () => {
    const original = base();
    const copy = cloneMacro(original, 'Copy', env);
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Copy');
    expect(copy.steps.map((s) => s.id).some((id) => ids(original).includes(id))).toBe(false);
    expect(copy.steps.map(({ id: _id, ...rest }) => rest)).toEqual(original.steps.map(({ id: _id, ...rest }) => rest));
  });
});

describe('MacroRecorder', () => {
  const options = { name: 'Recorded', platform: 'android' as const, coordinateSpace: 'screen-pixels' as const };

  function started(extra = {}) {
    const env = testEnv(1_000_000);
    const recorder = new MacroRecorder({ ...options, ...extra, env });
    recorder.start();
    return { recorder, env };
  }

  it('records taps with their coordinates and the delay between them', () => {
    const { recorder, env } = started();
    recorder.record({ type: 'tap', x: 100, y: 200, at: 1_000_500, durationMs: 80 });
    recorder.record({ type: 'tap', x: 300, y: 400, at: 1_002_000 });
    env.advance(0);

    const macro = recorder.stop();
    expect(macro.steps).toHaveLength(2);
    expect(macro.steps[0]).toMatchObject({ type: 'tap', x: 100, y: 200, durationMs: 80, delayMs: 0 });
    // the first tap ended at 1_000_580, so the second starts 1_420 ms later
    expect(macro.steps[1]).toMatchObject({ x: 300, y: 400, durationMs: 50, delayMs: 1420 });
    expect(macro).toMatchObject({ name: 'Recorded', platform: 'android', repeat: { count: 1, delayBetweenMs: 0 } });
  });

  it('can count the time before the first tap as its delay', () => {
    const { recorder } = started({ includeLeadingDelay: true });
    recorder.record({ type: 'tap', x: 1, y: 1, at: 1_003_000 });
    expect(recorder.stop().steps[0].delayMs).toBe(3000);
  });

  it('refuses what it cannot record, and says why', () => {
    const { recorder } = started({ screen: { width: 1080, height: 2400 } });
    expect(recorder.record({ type: 'swipe', x: 1, y: 1 })).toEqual({ ok: false, reason: '"swipe" actions cannot be recorded' });
    expect(recorder.record({ type: 'tap', x: -1, y: 1 })).toMatchObject({ ok: false });
    expect(recorder.record({ type: 'tap', x: NaN, y: 1 })).toMatchObject({ ok: false });
    expect(recorder.record({ type: 'tap', x: 5000, y: 1 })).toMatchObject({ ok: false, reason: expect.stringContaining('outside') });
    expect(recorder.record({ type: 'tap', x: 1, y: 1, durationMs: 0 })).toMatchObject({ ok: false });
    expect(recorder.stepCount).toBe(0);
  });

  it('only records while recording, and does not count paused time as a delay', () => {
    const { recorder, env } = started();
    recorder.record({ type: 'tap', x: 1, y: 1, at: 1_000_000 });
    recorder.pause();
    expect(recorder.record({ type: 'tap', x: 2, y: 2 })).toMatchObject({ ok: false });

    env.advance(60_000);
    recorder.resume();
    recorder.record({ type: 'tap', x: 3, y: 3, at: 1_060_300 });
    expect(recorder.stop().steps.map((s) => s.delayMs)).toEqual([0, 300]);
  });

  it('refuses to record before start and after stop', () => {
    const recorder = new MacroRecorder({ ...options, env: testEnv() });
    expect(recorder.record({ type: 'tap', x: 1, y: 1 })).toMatchObject({ ok: false });
    recorder.start();
    recorder.stop();
    expect(recorder.record({ type: 'tap', x: 1, y: 1 })).toMatchObject({ ok: false });
    expect(recorder.start()).toBe(false);
  });

  it('undoes the last tap', () => {
    const { recorder } = started();
    recorder.record({ type: 'tap', x: 1, y: 1 });
    recorder.record({ type: 'tap', x: 2, y: 2 });
    expect(recorder.undoLast()).toMatchObject({ x: 2 });
    expect(recorder.stop().steps).toHaveLength(1);
  });

  it('produces a macro that is valid as it is', () => {
    const { recorder } = started();
    recorder.record({ type: 'tap', x: 540, y: 1820 });
    const macro = recorder.stop();
    expect(macro.schemaVersion).toBe(1);
    expect(macro.steps[0].id).toMatch(/^step_/);
  });

  it('caps absurd delays at the supported maximum', () => {
    const { recorder } = started();
    recorder.record({ type: 'tap', x: 1, y: 1, at: 1_000_000 });
    recorder.record({ type: 'tap', x: 2, y: 2, at: 1_000_000 + 10 * 3_600_000 });
    expect(recorder.stop().steps[1].delayMs).toBe(3_600_000);
  });
});
