import { DEFAULT_AUTO_CONFIG, runAutomation, runPoints, type AutoConfig, type RunnerDeps, type ScreenNode } from '..';

type Btn = { y: number; done: boolean; tapsNeeded: number; taps: number };

/** A fake app: tab buttons at the top, a list of "Đăng ký" buttons per tab. */
function simApp(tabs: Record<string, number[]>, opts: { pkg?: string; flaky?: number[]; visibleTabs?: number } = {}) {
  const names = Object.keys(tabs);
  let current = names[0];
  const vis = opts.visibleTabs ?? names.length;
  let offset = 0;
  let swipes = 0;
  let time = 0;
  const buttons: Record<string, Btn[]> = {};
  for (const [name, ys] of Object.entries(tabs)) {
    buttons[name] = ys.map((y) => ({ y, done: false, tapsNeeded: opts.flaky?.includes(y) ? 2 : 1, taps: 0 }));
  }
  const tapLog: [number, number][] = [];

  const node = (text: string, x: number, y: number): ScreenNode => ({ text, x, y, w: 100, h: 40, clickable: true });

  const deps: RunnerDeps = {
    snapshot: () => ({
      pkg: opts.pkg ?? 'com.school',
      self: 'com.flyclick',
      nodes: [
        ...names.slice(offset, offset + vis).map((n, i) => node(n, 100 + i * 150, 50)),
        ...buttons[current].map((b) => node(b.done ? 'Đã đăng ký' : 'Đăng ký', 500, b.y)),
      ],
    }),
    tap: async (x, y) => {
      tapLog.push([x, y]);
      names.slice(offset, offset + vis).forEach((n, i) => {
        if (Math.abs(x - (150 + i * 150)) < 50 && Math.abs(y - 70) < 20) current = n;
      });
      for (const b of buttons[current]) {
        if (!b.done && Math.abs(x - 550) < 50 && Math.abs(y - (b.y + 20)) < 20 && ++b.taps >= b.tapsNeeded) b.done = true;
      }
    },
    swipe: async (x1, _y1, x2) => {
      swipes++;
      offset = x2 < x1 ? Math.min(offset + 1, names.length - vis) : Math.max(offset - 1, 0);
    },
    sleep: async (ms) => {
      time += ms;
    },
    now: () => time,
  };
  return { deps, buttons, tapLog, current: () => current, swipes: () => swipes };
}

const cfg = (over: Partial<AutoConfig> = {}): AutoConfig => ({
  ...DEFAULT_AUTO_CONFIG,
  tabs: ['Thứ 2', 'Thứ 3'],
  keepWatching: false,
  ...over,
});

describe('runAutomation', () => {
  it('registers every button on tab 1, then opens tab 2 and does the same', async () => {
    const app = simApp({ 'Thứ 2': [200, 300], 'Thứ 3': [200] });
    const result = await runAutomation(app.deps, cfg(), new AbortController().signal);

    expect(result.status).toBe('completed');
    expect(result.tabs.map((t) => [t.status, t.registered])).toEqual([
      ['done', 2],
      ['done', 1],
    ]);
    expect(app.buttons['Thứ 2'].every((b) => b.done)).toBe(true);
    expect(app.buttons['Thứ 3'].every((b) => b.done)).toBe(true);
    expect(app.current()).toBe('Thứ 3');
  });

  it('keeps clicking a button until it turns into "Đã đăng ký"', async () => {
    const app = simApp({ 'Thứ 2': [200], 'Thứ 3': [] }, { flaky: [200] });
    const result = await runAutomation(app.deps, cfg(), new AbortController().signal);

    expect(result.status).toBe('completed');
    expect(app.buttons['Thứ 2'][0].taps).toBe(2);
  });

  it('clicks every button on screen again and again, not just one once', async () => {
    const app = simApp({ 'Thứ 2': [200, 300, 400], 'Thứ 3': [] });
    for (const b of app.buttons['Thứ 2']) b.tapsNeeded = 3;
    const result = await runAutomation(app.deps, cfg(), new AbortController().signal);

    expect(result.status).toBe('completed');
    expect(app.buttons['Thứ 2'].map((b) => b.taps)).toEqual([3, 3, 3]);
    expect(result.tabs[0].registered).toBe(3);
  });

  it('never clicks a button that already says "Đã đăng ký"', async () => {
    const app = simApp({ 'Thứ 2': [200], 'Thứ 3': [] });
    app.buttons['Thứ 2'][0].done = true;
    const result = await runAutomation(app.deps, cfg(), new AbortController().signal);

    expect(result.status).toBe('completed');
    expect(app.buttons['Thứ 2'][0].taps).toBe(0);
  });

  it('stops with TAB_NOT_FOUND when the next tab is missing', async () => {
    const app = simApp({ 'Thứ 2': [200] });
    const result = await runAutomation(app.deps, cfg({ tabs: ['Thứ 2', 'Thứ 9'] }), new AbortController().signal);

    expect(result).toMatchObject({ status: 'partial', reason: 'TAB_NOT_FOUND' });
  });

  it('does nothing while FlyClick itself is in front, until stopped', async () => {
    const app = simApp({ 'Thứ 2': [200], 'Thứ 3': [] }, { pkg: 'com.flyclick' });
    const abort = new AbortController();
    const base = app.deps.sleep;
    let sleeps = 0;
    app.deps.sleep = async (ms, s) => {
      if (++sleeps === 5) abort.abort();
      await base(ms, s);
    };
    const result = await runAutomation(app.deps, cfg(), abort.signal);

    expect(result).toMatchObject({ status: 'stopped', reason: 'USER_STOPPED' });
    expect(app.tapLog).toHaveLength(0);
  });

  it('respects the time and click limits', async () => {
    const slow = simApp({ 'Thứ 2': [200], 'Thứ 3': [] });
    slow.buttons['Thứ 2'][0].tapsNeeded = 999;
    expect((await runAutomation(slow.deps, cfg({ maxRunMs: 5000, clickIntervalMs: 10 }), new AbortController().signal)).status).toBe('timeout');

    const many = simApp({ 'Thứ 2': [200], 'Thứ 3': [] });
    many.buttons['Thứ 2'][0].tapsNeeded = 999;
    const r = await runAutomation(many.deps, cfg({ maxClicks: 3 }), new AbortController().signal);
    expect(r).toMatchObject({ status: 'failed', reason: 'MAX_CLICKS' });
  });

  it('scrolls the tab bar sideways to reach tabs that are off screen', async () => {
    const days = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    const app = simApp(Object.fromEntries(days.map((d) => [d, [200]])), { visibleTabs: 3 });
    const result = await runAutomation(app.deps, cfg({ tabs: days }), new AbortController().signal);

    expect(result.status).toBe('completed');
    expect(result.tabs.map((t) => t.registered)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(app.swipes()).toBeGreaterThan(0);
  });

  it('ends with TAB_NOT_FOUND instead of swiping forever when a tab does not exist', async () => {
    const app = simApp({ 'Thứ 2': [200], 'Thứ 3': [], 'Thứ 4': [] }, { visibleTabs: 2 });
    const result = await runAutomation(app.deps, cfg({ tabs: ['Thứ 2', 'Thứ 9'] }), new AbortController().signal);

    expect(result).toMatchObject({ status: 'partial', reason: 'TAB_NOT_FOUND' });
    expect(app.swipes()).toBeLessThan(20);
  });
});

describe('keepWatching', () => {
  it('keeps clicking new buttons on the last tab until stopped', async () => {
    const app = simApp({ 'Thứ 2': [200], 'Thứ 3': [200] });
    const abort = new AbortController();
    const base = app.deps.sleep;
    let idle = 0;
    app.deps.sleep = async (ms, s) => {
      // Once everything is registered, "the user" switches tabs by hand twice, then stops.
      if (app.buttons['Thứ 3'][0].done && ++idle === 3) abort.abort();
      await base(ms, s);
    };
    const r = await runAutomation(app.deps, cfg({ keepWatching: true }), abort.signal);
    expect(r).toMatchObject({ status: 'stopped', reason: 'USER_STOPPED' });
    expect(app.buttons['Thứ 3'][0].done).toBe(true);
  });
});

describe('runPoints', () => {
  const deps = (over: Partial<RunnerDeps> = {}) => {
    const taps: [number, number][] = [];
    const d = {
      snapshot: () => ({ pkg: 'com.other', self: 'com.flyclick', nodes: [] }),
      tap: async (x: number, y: number) => {
        taps.push([x, y]);
      },
      sleep: async () => undefined,
      ...over,
    };
    return { d, taps };
  };
  const points = [
    { x: 100, y: 200 },
    { x: 300, y: 400 },
  ];

  it('taps the points in order, for the number of rounds', async () => {
    const { d, taps } = deps();
    const r = await runPoints(d, { points, pointIntervalMs: 10, pointRounds: 2 }, new AbortController().signal);

    expect(r).toMatchObject({ status: 'completed', clicks: 4 });
    expect(taps).toEqual([[100, 200], [300, 400], [100, 200], [300, 400]]);
  });

  it('runs until stopped when rounds is 0', async () => {
    const abort = new AbortController();
    const taps: [number, number][] = [];
    const { d } = deps({
      tap: async (x, y) => {
        taps.push([x, y]);
        if (taps.length === 7) abort.abort();
      },
    });
    const r = await runPoints(d, { points, pointIntervalMs: 0, pointRounds: 0 }, abort.signal);

    expect(r).toMatchObject({ status: 'stopped', reason: 'USER_STOPPED' });
    expect(taps).toHaveLength(7);
  });

  it('does not tap while FlyClick is in front, and fails without points', async () => {
    const abort = new AbortController();
    let polls = 0;
    const { d, taps } = deps({
      snapshot: () => {
        if (++polls === 3) abort.abort();
        return { pkg: 'com.flyclick', self: 'com.flyclick', nodes: [] };
      },
    });
    expect((await runPoints(d, { points, pointIntervalMs: 0, pointRounds: 1 }, abort.signal)).status).toBe('stopped');
    expect(taps).toHaveLength(0);

    const none = await runPoints(deps().d, { points: [], pointIntervalMs: 0, pointRounds: 1 }, new AbortController().signal);
    expect(none).toMatchObject({ status: 'failed', reason: 'NO_POINTS' });
  });

  it('sends taps in batches that cycle 1 -> 2 -> 1 without stopping', async () => {
    const abort = new AbortController();
    const seq: number[][] = [];
    const { d } = deps({
      tapSequence: async (flat: number[], count: number) => {
        seq.push(flat.slice(0, count * 2));
        if (seq.length === 3) abort.abort();
      },
    });
    const r = await runPoints(d, { points, pointIntervalMs: 10, pointRounds: 0 }, abort.signal);

    expect(r.status).toBe('stopped');
    const xs = seq.flatMap((f) => f.filter((_, i) => i % 2 === 0));
    expect(xs.slice(0, 5)).toEqual([100, 300, 100, 300, 100]);
    // The next batch continues the cycle where the last one stopped.
    const first = seq[0].length / 2;
    expect(seq[1][0]).toBe(first % 2 === 0 ? 100 : 300);
  });
});
