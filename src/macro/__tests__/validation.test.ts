import { parseMacro, validateForPlayback, type PlaybackContext } from '..';
import { macroOf, tap, testEnv, wait } from '../__fixtures__/helpers';

const android: PlaybackContext = {
  platform: 'android',
  capabilities: { crossApp: true, supportsDuration: true, coordinateSpace: 'screen-pixels', description: '' },
};
const ios: PlaybackContext = {
  platform: 'ios-in-app',
  capabilities: { crossApp: false, supportsDuration: false, coordinateSpace: 'window-points', description: '' },
};

const codes = (report: { issues: { code: string }[] }) => report.issues.map((i) => i.code);

describe('parseMacro', () => {
  const env = testEnv();
  const valid = () => ({
    schemaVersion: 1,
    id: 'm1',
    name: 'Sign up',
    platform: 'android',
    coordinateSpace: 'screen-pixels',
    repeat: { count: 3, delayBetweenMs: 500 },
    steps: [
      { id: 's1', type: 'tap', x: 100, y: 200, durationMs: 80, delayMs: 10 },
      { id: 's2', type: 'wait', durationMs: 1000 },
    ],
  });

  it('accepts a valid macro and fills defaults', () => {
    const { macro, issues } = parseMacro(valid(), env);
    expect(issues).toEqual([]);
    expect(macro).toMatchObject({ id: 'm1', name: 'Sign up', repeat: { count: 3, delayBetweenMs: 500 } });
    expect(macro!.steps[1]).toMatchObject({ type: 'wait', durationMs: 1000, delayMs: 0 });
    expect(macro!.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('defaults the tap duration and the repeat', () => {
    const raw = { ...valid(), repeat: undefined, steps: [{ type: 'tap', x: 1, y: 2 }] };
    const { macro } = parseMacro(raw, env);
    expect(macro!.repeat).toEqual({ count: 1, delayBetweenMs: 0 });
    expect(macro!.steps[0]).toMatchObject({ durationMs: 50, delayMs: 0 });
    expect(macro!.steps[0].id).toMatch(/^step_/);
  });

  it('generates a missing id with a warning', () => {
    const { macro, issues } = parseMacro({ ...valid(), id: undefined }, env);
    expect(macro!.id).toMatch(/^macro_/);
    expect(codes({ issues })).toContain('MISSING_ID');
  });

  it('copies only known fields, so hostile input cannot leak through', () => {
    const raw = JSON.parse(
      '{"name":"x","platform":"any","coordinateSpace":"screen-pixels","__proto__":{"polluted":true},"evil":1,"steps":[{"type":"tap","x":1,"y":1,"constructor":"bad","extra":9}]}',
    );
    const { macro } = parseMacro(raw, env);
    expect(macro).not.toHaveProperty('evil');
    expect(macro!.steps[0]).not.toHaveProperty('extra');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it.each([
    ['not an object', 'text', 'INVALID_MACRO'],
    ['null', null, 'INVALID_MACRO'],
    ['no name', { ...valid(), name: '  ' }, 'INVALID_NAME'],
    ['long name', { ...valid(), name: 'x'.repeat(101) }, 'INVALID_NAME'],
    ['bad platform', { ...valid(), platform: 'windows' }, 'INVALID_PLATFORM'],
    ['bad coordinate space', { ...valid(), coordinateSpace: 'cm' }, 'INVALID_COORDINATE_SPACE'],
    ['newer schema', { ...valid(), schemaVersion: 2 }, 'UNSUPPORTED_VERSION'],
    ['steps not array', { ...valid(), steps: 'no' }, 'INVALID_STEPS'],
    ['repeat not object', { ...valid(), repeat: 3 }, 'INVALID_REPEAT'],
    ['zero repeat', { ...valid(), repeat: { count: 0 } }, 'INVALID_VALUE'],
    ['fractional repeat', { ...valid(), repeat: { count: 1.5 } }, 'INVALID_VALUE'],
    ['unknown step type', { ...valid(), steps: [{ type: 'teleport' }] }, 'UNKNOWN_STEP_TYPE'],
    ['step not object', { ...valid(), steps: [7] }, 'INVALID_STEP'],
    ['negative coordinate', { ...valid(), steps: [{ type: 'tap', x: -1, y: 0 }] }, 'INVALID_VALUE'],
    ['NaN coordinate', { ...valid(), steps: [{ type: 'tap', x: NaN, y: 0 }] }, 'INVALID_VALUE'],
    ['string coordinate', { ...valid(), steps: [{ type: 'tap', x: '1', y: 0 }] }, 'INVALID_VALUE'],
    ['zero duration', { ...valid(), steps: [{ type: 'tap', x: 1, y: 1, durationMs: 0 }] }, 'INVALID_VALUE'],
    ['huge delay', { ...valid(), steps: [{ type: 'tap', x: 1, y: 1, delayMs: 1e12 }] }, 'INVALID_VALUE'],
    ['wait without duration', { ...valid(), steps: [{ type: 'wait' }] }, 'INVALID_VALUE'],
    ['swipe missing end', { ...valid(), steps: [{ type: 'swipe', x: 1, y: 1 }] }, 'INVALID_VALUE'],
    ['duplicate step ids', { ...valid(), steps: [{ id: 'a', type: 'tap', x: 1, y: 1 }, { id: 'a', type: 'tap', x: 2, y: 2 }] }, 'DUPLICATE_STEP_ID'],
  ])('rejects %s', (_label, raw, code) => {
    const { macro, issues } = parseMacro(raw, env);
    expect(macro).toBeNull();
    expect(codes({ issues })).toContain(code);
  });

  it('rejects too many steps', () => {
    const steps = Array.from({ length: 5001 }, () => ({ type: 'tap', x: 1, y: 1 }));
    expect(codes({ issues: parseMacro({ ...valid(), steps }, env).issues })).toContain('TOO_MANY_STEPS');
  });

  it('labels step errors with the step number', () => {
    const { issues } = parseMacro({ ...valid(), steps: [{ type: 'tap', x: 1, y: 1 }, { type: 'tap', x: -5, y: 1 }] }, env);
    expect(issues.find((i) => i.level === 'error')!.message).toMatch(/^Step 2:/);
  });
});

describe('validateForPlayback', () => {
  it('accepts a valid Android macro', () => {
    const report = validateForPlayback(macroOf([tap('a', 100, 200), wait('w', 500)]), android);
    expect(report).toEqual({ ok: true, issues: [] });
  });

  it('blocks an empty macro', () => {
    expect(codes(validateForPlayback(macroOf([]), android))).toContain('EMPTY_MACRO');
  });

  it('blocks everything on an unsupported platform', () => {
    const report = validateForPlayback(macroOf([tap('a', 1, 1)]), { ...android, platform: 'unsupported' });
    expect(report.ok).toBe(false);
    expect(codes(report)).toEqual(['UNSUPPORTED_PLATFORM']);
  });

  it('blocks a macro recorded for another platform', () => {
    const report = validateForPlayback(macroOf([tap('a', 1, 1)], { platform: 'ios', coordinateSpace: 'screen-pixels' }), android);
    expect(codes(report)).toContain('PLATFORM_MISMATCH');
  });

  it('allows platform "any" but still checks the coordinate space', () => {
    expect(validateForPlayback(macroOf([tap('a', 1, 1)], { platform: 'any' }), android).ok).toBe(true);
    const wrongSpace = macroOf([tap('a', 1, 1)], { platform: 'any', coordinateSpace: 'window-points' });
    expect(codes(validateForPlayback(wrongSpace, android))).toContain('COORDINATE_SPACE_MISMATCH');
  });

  it('rejects swipes, which no adapter can perform yet', () => {
    const macro = macroOf([{ id: 'sw', type: 'swipe', x: 1, y: 1, toX: 5, toY: 5, durationMs: 300, delayMs: 0 }]);
    const report = validateForPlayback(macro, android);
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toMatchObject({ code: 'UNSUPPORTED_ACTION', stepId: 'sw' });
  });

  it('rejects taps outside the screen', () => {
    const macro = macroOf([tap('a', 100, 100), tap('b', 5000, 100)]);
    const report = validateForPlayback(macro, { ...android, screen: { width: 1080, height: 2400 } });
    expect(report.issues).toEqual([expect.objectContaining({ code: 'OUT_OF_BOUNDS', stepId: 'b' })]);
  });

  describe('iOS (in-app only)', () => {
    const iosMacro = (steps = [tap('a', 10, 10)]) => macroOf(steps, { platform: 'ios', coordinateSpace: 'window-points' });

    it('requires a control of this app at every tapped point', () => {
      const hitTest = (x: number) => x < 100;
      const report = validateForPlayback(iosMacro([tap('a', 10, 10), tap('b', 500, 10)]), { ...ios, hitTest });
      expect(report.ok).toBe(false);
      expect(report.issues).toEqual([expect.objectContaining({ code: 'NO_CONTROL_AT_POINT', stepId: 'b' })]);
    });

    it('warns when it cannot check', () => {
      const report = validateForPlayback(iosMacro(), ios);
      expect(report.ok).toBe(true);
      expect(codes(report)).toContain('UNVERIFIED_TARGET');
    });

    it('warns that the tap duration is ignored', () => {
      const report = validateForPlayback(iosMacro([tap('a', 10, 10, 0, 800)]), { ...ios, hitTest: () => true });
      expect(report.ok).toBe(true);
      expect(codes(report)).toEqual(['DURATION_IGNORED']);
    });

    it('does not accept an Android macro', () => {
      const report = validateForPlayback(macroOf([tap('a', 1, 1)]), ios);
      expect(codes(report)).toEqual(expect.arrayContaining(['PLATFORM_MISMATCH', 'COORDINATE_SPACE_MISMATCH']));
    });
  });

  it('blocks a macro that would expand to too many steps', () => {
    const macro = macroOf([tap('a', 1, 1), tap('b', 2, 2)], { repeat: { count: 60_000, delayBetweenMs: 0 } });
    expect(codes(validateForPlayback(macro, android))).toContain('TOO_LARGE');
  });
});
