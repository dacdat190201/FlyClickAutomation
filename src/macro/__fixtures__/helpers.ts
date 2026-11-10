import type { Macro, MacroEnv, MacroStep } from '..';

/** Deterministic ids and clock. */
export function testEnv(start = Date.UTC(2026, 0, 1)): MacroEnv & { advance(ms: number): void } {
  let time = start;
  let n = 0;
  return {
    now: () => time,
    newId: (prefix) => `${prefix}_${++n}`,
    advance: (ms) => {
      time += ms;
    },
  };
}

export const tap = (id: string, x: number, y: number, delayMs = 0, durationMs = 50): MacroStep => ({
  id,
  type: 'tap',
  x,
  y,
  durationMs,
  delayMs,
});

export const wait = (id: string, durationMs: number, delayMs = 0): MacroStep => ({
  id,
  type: 'wait',
  durationMs,
  delayMs,
});

export function macroOf(steps: MacroStep[], overrides: Partial<Macro> = {}): Macro {
  return {
    schemaVersion: 1,
    id: 'macro_a',
    name: 'Test macro',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    platform: 'android',
    coordinateSpace: 'screen-pixels',
    repeat: { count: 1, delayBetweenMs: 0 },
    steps,
    ...overrides,
  };
}
