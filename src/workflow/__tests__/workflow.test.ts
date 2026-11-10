import { EngineState } from '../../engine';
import { SimApp, row } from '../__fixtures__/sim-app';
import { SmartRegistrationWorkflow } from '..';
import { build, settle } from '../__fixtures__/helpers';

const single = (...rows: ReturnType<typeof row>[]) => new SimApp({ 'Tab A': rows });

describe('SmartRegistrationWorkflow', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('happy path', () => {
    it('registers every target once, in order, and completes', async () => {
      const app = single(row('Khóa 1'), row('Khóa 2'), row('Khóa 3'));
      const { workflow } = build(app);

      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('completed');
      expect(app.tabs['Tab A'].every((r) => r.registered)).toBe(true);
      expect([...app.registerTaps.values()]).toEqual([1, 1, 1]);
      expect(result.tabs[0]).toMatchObject({ name: 'Tab A', status: 'completed' });
      expect(result.tabs[0].registered).toHaveLength(3);
      expect(result.tabs[0].failed).toHaveLength(0);
      expect(workflow.getState()).toBe(EngineState.COMPLETED);
    });

    it('clicks targets top to bottom', async () => {
      const app = single(row('Khóa 1'), row('Khóa 2'));
      const { workflow } = build(app);
      await settle(workflow.runToEnd());
      expect(app.taps.map((t) => t.y)).toEqual([315, 515]);
    });

    it('never clicks a button that already says "Đã đăng ký"', async () => {
      const app = single(row('Khóa 1'), row('Khóa 2', 'normal', { registered: true }), row('Khóa 3'));
      const { workflow } = build(app);
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('completed');
      expect(app.registerTaps.has('Khóa 2')).toBe(false);
      expect(app.repeatHits).toBe(0);
      expect(app.totalRegisterTaps).toBe(2);
    });

    it('finishes immediately when nothing needs registering', async () => {
      const app = single(row('Khóa 1', 'normal', { registered: true }));
      const { workflow } = build(app);
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('completed');
      expect(result.totalClicks).toBe(0);
      expect(app.taps).toHaveLength(0);
    });

    it('waits for a delayed UI update instead of retrying', async () => {
      const app = single(row('Khóa 1', 'delayed', { delay: 2 }));
      const { workflow } = build(app);
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('completed');
      expect(app.registerTaps.get('Khóa 1')).toBe(1);
      expect(result.tabs[0].registered[0].attempts).toBe(1);
    });

    it('does not accept success text that was already there before the click', async () => {
      // A "Đã đăng ký" label sits next to the dead button from the start.
      const app = single(row('Khóa 1', 'dead'), row('Khóa 2', 'normal', { registered: true }));
      const { workflow } = build(app, { maxRetriesPerTarget: 0 });
      const result = await settle(workflow.runToEnd());

      expect(result.tabs[0].registered).toHaveLength(0);
      expect(result.tabs[0].failed).toHaveLength(1);
    });
  });

  describe('multiple tabs', () => {
    const twoTabs = () =>
      new SimApp({
        'Tab A': [row('A1'), row('A2')],
        'Tab B': [row('B1'), row('B2'), row('B3')],
      });

    it('processes every tab, navigating by the tab label', async () => {
      const app = twoTabs();
      const { workflow } = build(app);
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('completed');
      expect(result.tabs.map((t) => [t.name, t.status, t.registered.length])).toEqual([
        ['Tab A', 'completed', 2],
        ['Tab B', 'completed', 3],
      ]);
      expect(app.current).toBe('Tab B');
      expect(app.totalRegisterTaps).toBe(5);
    });

    it('stops gracefully when tab navigation is not supported', async () => {
      const app = new SimApp({
        'Tab A': [row('A1')],
        'Tab B': [row('B1')],
        'Tab C': [row('C1')],
      });
      const { workflow, adapter } = build(app);
      adapter.rejectTabTaps = true;
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('partial');
      expect(result.reason).toBe('NAVIGATION_UNSUPPORTED');
      expect(result.tabs.map((t) => t.status)).toEqual(['completed', 'not-reached', 'not-reached']);
      expect(app.registerTaps.has('B1')).toBe(false);
    });

    it('fails when the tab label cannot be found on screen', async () => {
      const app = twoTabs();
      const { workflow } = build(app, { tabs: [{ name: 'Tab A' }, { name: 'Tab Z' }] });
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('failed');
      expect(result.reason).toBe('NAVIGATION_FAILED');
      expect(result.tabs[1].status).toBe('failed');
    });

    it('fails when clicking the tab does not open it', async () => {
      const app = new SimApp({ 'Tab A': [row('A1')], 'Tab B': [row('B1')] }, { tabsInert: true });
      const { workflow } = build(app);
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('failed');
      expect(result.reason).toBe('NAVIGATION_FAILED');
    });

    it('can verify a tab by a keyword and use a custom label', async () => {
      const app = twoTabs();
      const { workflow } = build(app, {
        tabs: [{ name: 'First' }, { name: 'Second', label: 'Tab B', verifyKeyword: 'B1' }],
      });
      const result = await settle(workflow.runToEnd());
      expect(result.status).toBe('completed');
      expect(result.tabs[1].registered).toHaveLength(3);
    });
  });

  describe('safeguards', () => {
    it('gives up on a target after the retry limit and carries on with the others', async () => {
      const app = single(row('Khóa 1'), row('Khóa 2', 'dead'), row('Khóa 3'));
      const { workflow } = build(app, { maxRetriesPerTarget: 2 });
      const result = await settle(workflow.runToEnd());

      expect(app.registerTaps.get('Khóa 2')).toBe(3); // 1 try + 2 retries, then it stops
      expect(app.registerTaps.get('Khóa 1')).toBe(1);
      expect(app.registerTaps.get('Khóa 3')).toBe(1);
      expect(result.status).toBe('partial');
      expect(result.reason).toBe('TARGET_FAILED');
      expect(result.tabs[0].registered).toHaveLength(2);
      expect(result.tabs[0].failed).toHaveLength(1);
      expect(result.tabs[0].failed[0].attempts).toBe(3);
    });

    it('does not retry at all when maxRetriesPerTarget is 0', async () => {
      const app = single(row('Khóa 1', 'dead'));
      const { workflow } = build(app, { maxRetriesPerTarget: 0 });
      await settle(workflow.runToEnd());
      expect(app.registerTaps.get('Khóa 1')).toBe(1);
    });

    it('never clicks a target twice when its success only shows up after verification timed out', async () => {
      // The UI updates on the 5th capture: after the verification window, before the next scan.
      const app = single(row('Khóa 1', 'delayed', { delay: 5 }));
      const { workflow, logs } = build(app, {}, { verifyTimeoutMs: 150 });
      const result = await settle(workflow.runToEnd());

      expect(app.registerTaps.get('Khóa 1')).toBe(1);
      expect(result.status).toBe('completed');
      expect(result.tabs[0].registered).toHaveLength(1);
      expect(logs.some((l) => /not clicking again/.test(l.message))).toBe(true);
    });

    it('stops when the screen content changes unexpectedly', async () => {
      const app = single(row('Khóa 1'), row('Khóa 2', 'popup'), row('Khóa 3'));
      const { workflow } = build(app);
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('failed');
      expect(result.reason).toBe('UNEXPECTED_SCREEN');
      expect(app.registerTaps.has('Khóa 3')).toBe(false); // no clicks after the surprise
      expect(app.taps).toHaveLength(2);
      expect(result.log.some((l) => l.step === 'safeguard' && l.level === 'error')).toBe(true);
    });

    it('does not mistake the expected button change for an unexpected one', async () => {
      const app = single(row('Khóa 1'));
      const { workflow } = build(app, { minScreenSimilarity: 0.99 });
      const result = await settle(workflow.runToEnd());
      expect(result.status).toBe('completed');
    });

    it('stops after the maximum execution time', async () => {
      const app = single(row('Khóa 1', 'dead'));
      const { workflow } = build(app, { maxExecutionMs: 3000, maxRetriesPerTarget: 100 });
      const result = await settle(workflow.runToEnd());
      const clicksAtStop = app.taps.length;

      expect(result.status).toBe('timeout');
      expect(workflow.getState()).toBe(EngineState.STOPPED);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(app.taps.length).toBe(clicksAtStop); // nothing after the limit
    });

    it('stops after the maximum number of clicks', async () => {
      const app = single(row('Khóa 1'), row('Khóa 2'), row('Khóa 3'));
      const { workflow } = build(app, { maxClicks: 2 });
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('failed');
      expect(result.reason).toBe('MAX_CLICKS');
      expect(app.totalRegisterTaps).toBe(2);
    });

    it('fails clearly when clicking is unavailable', async () => {
      const app = single(row('Khóa 1'));
      const { workflow, adapter } = build(app);
      adapter.available = false;
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('failed');
      expect(result.reason).toBe('CLICK_UNAVAILABLE');
    });

    it('fails clearly when screen capture is no longer permitted', async () => {
      const app = single(row('Khóa 1'), row('Khóa 2'));
      const { workflow, screen } = build(app);
      screen.failFrom = 3;
      const result = await settle(workflow.runToEnd());

      expect(result.status).toBe('failed');
      expect(result.reason).toBe('CAPTURE_FAILED');
    });
  });

  describe('control', () => {
    it('can be stopped, and then does nothing more', async () => {
      const app = single(row('Khóa 1'), row('Khóa 2'), row('Khóa 3'), row('Khóa 4'));
      const { workflow } = build(app, { settleDelayMs: 500 }); // slow enough to catch mid-run
      expect(workflow.start()).toBe(true);
      await jest.advanceTimersByTimeAsync(60);
      expect(workflow.stop()).toBe(true);

      const result = await settle(workflow.whenDone());
      const taps = app.taps.length;
      await jest.advanceTimersByTimeAsync(5000);

      expect(result.status).toBe('stopped');
      expect(app.taps.length).toBe(taps);
      expect(app.totalRegisterTaps).toBeLessThan(4);
      expect(result.tabs[0].status).toBe('stopped');
    });

    it('can be paused and resumed', async () => {
      const app = single(row('Khóa 1'), row('Khóa 2'), row('Khóa 3'));
      const { workflow } = build(app, { settleDelayMs: 500 }); // slow enough to catch mid-run
      workflow.start();
      await jest.advanceTimersByTimeAsync(40);

      expect(workflow.pause()).toBe(true);
      await jest.advanceTimersByTimeAsync(2000); // let the step in flight finish
      const tapsWhilePaused = app.taps.length;
      await jest.advanceTimersByTimeAsync(5000);

      expect(app.taps.length).toBe(tapsWhilePaused);
      expect(workflow.getState()).toBe(EngineState.PAUSED);
      expect(app.totalRegisterTaps).toBeLessThan(3);

      expect(workflow.resume()).toBe(true);
      const result = await settle(workflow.whenDone());
      expect(result.status).toBe('completed');
      expect([...app.registerTaps.values()]).toEqual([1, 1, 1]);
    });

    it('rejects a second start while running', async () => {
      const { workflow } = build(single(row('Khóa 1')));
      expect(workflow.start()).toBe(true);
      expect(workflow.start()).toBe(false);
      await expect(workflow.runToEnd()).rejects.toThrow(/already active/);
      await settle(workflow.whenDone());
    });

    it('can run again after finishing', async () => {
      const app = single(row('Khóa 1'));
      const { workflow } = build(app);
      await settle(workflow.runToEnd());

      app.tabs['Tab A'].push(row('Khóa 2'));
      const second = await settle(workflow.runToEnd());
      expect(second.status).toBe('completed');
      expect(app.registerTaps.get('Khóa 2')).toBe(1);
      expect(app.registerTaps.get('Khóa 1')).toBe(1);
    });
  });

  describe('logging', () => {
    it('logs every step of the workflow, in order', async () => {
      const app = single(row('Khóa 1'));
      const { workflow, logs } = build(app);
      const result = await settle(workflow.runToEnd());

      const steps = result.log.map((l) => l.step);
      const first = (step: string) => steps.indexOf(step);
      expect(first('run')).toBe(0);
      for (const step of ['capture', 'ocr', 'find', 'select', 'click', 'wait', 'verify', 'mark', 'next']) {
        expect(steps).toContain(step);
      }
      expect(first('capture')).toBeLessThan(first('select'));
      expect(first('select')).toBeLessThan(first('click'));
      expect(first('click')).toBeLessThan(first('verify'));
      expect(first('verify')).toBeLessThan(first('mark'));
      expect(first('mark')).toBeLessThan(first('next'));

      expect(logs).toEqual(result.log); // onLog saw exactly what was recorded
      expect(workflow.getLog()).toEqual(result.log);
      expect(result.log[result.log.length - 1].message).toBe('Workflow finished: COMPLETED');
    });

    it('records coordinates, attempts and errors', async () => {
      const app = single(row('Khóa 1', 'dead'));
      const { workflow } = build(app, { maxRetriesPerTarget: 1 });
      const result = await settle(workflow.runToEnd());

      const messages = result.log.map((l) => l.message);
      expect(messages.some((m) => /Clicking \(735, 315\)/.test(m))).toBe(true);
      expect(messages.some((m) => /attempt 2\/2/.test(m))).toBe(true);
      expect(result.log.some((l) => l.level === 'error' && /Giving up/.test(l.message))).toBe(true);
    });

    it('survives a throwing log listener', async () => {
      const app = single(row('Khóa 1'));
      const { workflow, clicker } = build(app);
      const screenless = new SmartRegistrationWorkflow(
        {
          screen: (workflow as unknown as { deps: { screen: never } }).deps.screen,
          ocr: (workflow as unknown as { deps: { ocr: never } }).deps.ocr,
          clicker,
          onLog: () => {
            throw new Error('log bug');
          },
        },
        { targetKeywords: ['Đăng ký'], successKeywords: ['Đã đăng ký'], tabs: [{ name: 'Tab A' }], settleDelayMs: 10 },
      );
      const result = await settle(screenless.runToEnd());
      expect(result.status).toBe('completed');
    });
  });

  describe('configuration', () => {
    const app = () => single(row('Khóa 1'));
    const bad = (config: object) => () => build(app(), config as never);

    it('validates the configuration', () => {
      expect(bad({ tabs: [] })).toThrow(RangeError);
      expect(bad({ targetKeywords: ['  '] })).toThrow(RangeError);
      expect(bad({ maxRetriesPerTarget: -1 })).toThrow(RangeError);
      expect(bad({ maxExecutionMs: 0 })).toThrow(RangeError);
      expect(bad({ minScreenSimilarity: 2 })).toThrow(RangeError);
    });

    it('reports a result even if it never ran', async () => {
      const { workflow } = build(app());
      const result = await workflow.whenDone();
      expect(result.status).toBe('stopped');
      expect(result.totalClicks).toBe(0);
    });
  });
});
