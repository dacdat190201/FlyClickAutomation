import { toClickError } from '../click';
import {
  AutomationEngine,
  EngineState,
  isTerminal,
  type AutomationAdapter,
  type AutomationTask,
  type EngineListener,
  type ExecutionContext,
} from '../engine';
import {
  cleanKeywords,
  findMatches,
  type MatchOptions,
  type OcrSearchConfig,
  type Point,
  type ScanResult,
  type TextMatch,
} from '../ocr';
import { fingerprint, similarity } from './screen-fingerprint';
import { TargetTracker } from './target-tracker';
import {
  WorkflowError,
  type LogLevel,
  type TabConfig,
  type TabResult,
  type WorkflowConfig,
  type WorkflowDeps,
  type WorkflowLogEntry,
  type WorkflowResult,
} from './types';

export const DEFAULT_WORKFLOW_CONFIG = {
  maxRetriesPerTarget: 2,
  maxExecutionMs: 10 * 60 * 1000,
  maxClicks: 500,
  settleDelayMs: 300,
  minScreenSimilarity: 0.5,
  verifyRadiusFactor: 2,
  tabLabelPick: 'last',
  navigateFirstTab: false,
} as const;

type RequiredConfig = Pick<WorkflowConfig, 'targetKeywords' | 'successKeywords' | 'tabs'>;

type RunState = {
  startedAt: number;
  tabs: TabResult[];
  clicks: number;
  clicksOk: number;
  clicksFailed: number;
  /** Most recent scan whose content passed the unexpected-change check. */
  lastScan: ScanResult | null;
  /** Set when remaining tabs cannot be reached (navigation unsupported). */
  halted: boolean;
  haltNote?: string;
  timedOut: boolean;
  /** A safeguard raised from inside a verification poll; thrown once the click settles. */
  fatal: WorkflowError | null;
  timer?: ReturnType<typeof setTimeout>;
  log: WorkflowLogEntry[];
};

function newRun(now: number, tabs: TabConfig[]): RunState {
  return {
    startedAt: now,
    tabs: tabs.map((t) => ({ name: t.name, status: 'pending', registered: [], failed: [] })),
    clicks: 0,
    clicksOk: 0,
    clicksFailed: 0,
    lastScan: null,
    halted: false,
    timedOut: false,
    fatal: null,
    log: [],
  };
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Sleeps `ms`; rejects if `signal` aborts first. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Connects OCR, the Click Engine and the Automation Engine into one registration run.
 *
 * The Automation Engine runs one task per configured tab (so pause, resume, stop and the
 * ERROR state come from it). Inside a tab the workflow loops: capture, OCR, pick the first
 * unprocessed "Đăng ký" target, click once with verification, and mark it done.
 */
export class SmartRegistrationWorkflow {
  private readonly deps: WorkflowDeps;
  private readonly config: WorkflowConfig;
  private readonly engine: AutomationEngine;
  private run: RunState;

  constructor(deps: WorkflowDeps, config: RequiredConfig & Partial<WorkflowConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_WORKFLOW_CONFIG, ...config };
    this.validate(this.config);
    this.run = newRun(this.now(), this.config.tabs);

    const adapter: AutomationAdapter = { execute: (task, ctx) => this.processTask(task, ctx) };
    this.engine = new AutomationEngine(adapter, { maxRetries: 0, defaultDelayMs: 0, retryDelayMs: 0 });
  }

  // ---- Public API --------------------------------------------------------------------------

  getState(): EngineState {
    return this.engine.getState();
  }

  getLog(): readonly WorkflowLogEntry[] {
    return this.run.log;
  }

  /** Subscribe to state/progress changes of the underlying Automation Engine. */
  subscribe(listener: EngineListener): () => void {
    return this.engine.subscribe(listener);
  }

  /** Returns false if a run is already active. */
  start(): boolean {
    const tasks: AutomationTask[] = this.config.tabs.map((tab, i) => ({
      id: `tab:${i}:${tab.name}`,
      type: 'process-tab',
      payload: { tabIndex: i },
    }));
    if (!this.engine.start(tasks)) return false;

    // The adapter only runs after this synchronous block, so it always sees the new state.
    const run = newRun(this.now(), this.config.tabs);
    this.run = run;
    this.log(run, 'info', 'run', `Workflow started with ${tasks.length} tab(s)`, {
      tabs: this.config.tabs.map((t) => t.name),
    });

    run.timer = setTimeout(() => {
      if (this.run !== run || isTerminal(this.engine.getState())) return;
      run.timedOut = true;
      this.log(run, 'warn', 'safeguard', `Maximum execution time (${this.config.maxExecutionMs} ms) reached; stopping`);
      this.engine.stop();
    }, this.config.maxExecutionMs);

    const off = this.engine.subscribe((s) => {
      if (!isTerminal(s.state)) return;
      clearTimeout(run.timer);
      off();
      this.log(run, s.state === EngineState.ERROR ? 'error' : 'info', 'run', `Workflow finished: ${s.state}`);
    });
    return true;
  }

  pause(): boolean {
    const ok = this.engine.pause();
    if (ok) this.log(this.run, 'info', 'run', 'Pause requested; takes effect before the next step');
    return ok;
  }

  resume(): boolean {
    const ok = this.engine.resume();
    if (ok) this.log(this.run, 'info', 'run', 'Resumed');
    return ok;
  }

  stop(): boolean {
    const ok = this.engine.stop();
    if (ok) this.log(this.run, 'info', 'run', 'Stop requested');
    return ok;
  }

  /** Resolves with the outcome once the run has fully finished. */
  async whenDone(): Promise<WorkflowResult> {
    await this.engine.whenIdle();
    return this.buildResult();
  }

  /** Starts a run and waits for it. Throws if a run is already active. */
  async runToEnd(): Promise<WorkflowResult> {
    if (!this.start()) throw new Error('A registration run is already active');
    return this.whenDone();
  }

  // ---- Per-tab task ------------------------------------------------------------------------

  private async processTask(task: AutomationTask, ctx: ExecutionContext): Promise<void> {
    const run = this.run;
    const tabIndex = task.payload?.tabIndex as number;
    const tab = this.config.tabs[tabIndex];
    const rec = run.tabs[tabIndex];

    if (run.halted) {
      rec.status = 'not-reached';
      rec.note = run.haltNote;
      return;
    }

    try {
      if (tabIndex > 0 || this.config.navigateFirstTab) {
        this.log(run, 'info', 'navigate', `Opening tab "${tab.name}"`);
        const outcome = await this.navigateToTab(ctx, run, tab);
        if (outcome === 'unsupported') {
          run.halted = true;
          run.haltNote = `Cannot navigate to "${tab.name}": this platform/adapter cannot click the tab button`;
          rec.status = 'not-reached';
          rec.note = run.haltNote;
          this.log(run, 'warn', 'navigate', run.haltNote);
          return;
        }
        if (ctx.signal.aborted) return;
      }
      rec.status = 'running';
      await this.processTab(ctx, run, tab, rec);
    } catch (e) {
      rec.status = 'failed';
      rec.note = e instanceof Error ? e.message : String(e);
      this.log(run, 'error', 'run', `Tab "${tab.name}" failed: ${rec.note}`);
      throw e;
    }
  }

  private async processTab(ctx: ExecutionContext, run: RunState, tab: TabConfig, rec: TabResult) {
    const tracker = new TargetTracker();

    for (;;) {
      await this.checkpoint(ctx.signal);
      if (ctx.signal.aborted) return;

      // Steps 1-3: capture an authorised image, run OCR, find the targets.
      const scan = await this.scan(ctx.signal, run, tab.name);
      if (ctx.signal.aborted) return;

      if (run.lastScan) {
        const unexpected = this.checkScreen(run, run.lastScan, scan);
        if (unexpected) throw unexpected;
      }
      run.lastScan = scan;
      this.reconcile(run, tracker, scan, rec);

      // Step 4: first target that is neither registered nor given up on.
      const pending = scan.targets.filter((t) => t.center && !tracker.isDone(t));
      this.log(run, 'info', 'select', `${scan.targets.length} target(s) on screen, ${pending.length} unprocessed`, {
        tab: tab.name,
      });

      // Steps 10-11: nothing left in this tab.
      if (pending.length === 0) {
        rec.status = 'completed';
        this.log(run, 'info', 'next', `Tab "${tab.name}" done: ${rec.registered.length} registered, ${rec.failed.length} failed`);
        return;
      }

      if (run.clicks >= this.config.maxClicks) {
        throw new WorkflowError('MAX_CLICKS', `Reached the limit of ${this.config.maxClicks} clicks`);
      }

      const target = pending[0];
      const center = target.center!;
      const attempt = tracker.recordAttempt(target);
      const maxAttempts = this.config.maxRetriesPerTarget + 1;
      this.log(run, 'info', 'select', `Selected "${target.matchedText}" at (${Math.round(center.x)}, ${Math.round(center.y)}), attempt ${attempt}/${maxAttempts}`);

      // Steps 5-9: one click, wait for the UI, OCR again, verify.
      const outcome = await this.clickAndVerify(ctx, run, tab, scan, target, attempt);
      if (outcome === 'aborted') return;

      if (outcome === 'verified') {
        tracker.markCompleted(center);
        rec.registered.push({ text: target.matchedText, center, attempts: attempt, at: this.now() });
        this.log(run, 'info', 'mark', `Registered "${target.matchedText}" at (${Math.round(center.x)}, ${Math.round(center.y)}) after ${attempt} attempt(s)`);
      } else if (outcome === 'give-up' || attempt >= maxAttempts) {
        tracker.markFailed(center);
        rec.failed.push({ text: target.matchedText, center, attempts: attempt, at: this.now() });
        this.log(run, 'error', 'mark', `Giving up on "${target.matchedText}" at (${Math.round(center.x)}, ${Math.round(center.y)}) after ${attempt} attempt(s)`);
      }
    }
  }

  /** Clicks once and checks that "Đã đăng ký" appeared next to the target. */
  private async clickAndVerify(
    ctx: ExecutionContext,
    run: RunState,
    tab: TabConfig,
    before: ScanResult,
    target: TextMatch,
    attempt: number,
  ): Promise<'verified' | 'retry' | 'give-up' | 'aborted'> {
    const center = target.center!;
    const clickAbort = new AbortController();
    const link = () => clickAbort.abort();
    ctx.signal.addEventListener('abort', link, { once: true });

    const baselineNear = this.nearCount(before.successes, target);
    let settled = false;

    const verify = async (): Promise<boolean> => {
      if (!settled) {
        settled = true;
        this.log(run, 'info', 'wait', `Waiting ${this.config.settleDelayMs} ms for the UI to update`);
        await sleep(this.config.settleDelayMs, clickAbort.signal);
      }
      let next: ScanResult;
      try {
        next = await this.scan(clickAbort.signal, run, tab.name);
      } catch (e) {
        if (e instanceof WorkflowError && !clickAbort.signal.aborted) {
          run.fatal = e;
          clickAbort.abort();
        }
        return false;
      }
      const unexpected = this.checkScreen(run, before, next);
      if (unexpected) {
        run.fatal = unexpected;
        clickAbort.abort();
        return false;
      }
      run.lastScan = next;
      const ok = this.isRegistered(target, baselineNear, before, next);
      this.log(run, ok ? 'info' : 'warn', 'verify', ok ? 'Success text found next to the target' : 'Success text not found yet');
      return ok;
    };

    run.clicks++;
    this.log(run, 'info', 'click', `Clicking (${Math.round(center.x)}, ${Math.round(center.y)})`, { attempt });
    try {
      await this.deps.clicker.click({ x: center.x, y: center.y }, { verify, allowRepeat: attempt > 1, signal: clickAbort.signal });
      run.clicksOk++;
      return 'verified';
    } catch (e) {
      if (run.fatal) {
        run.clicksFailed++;
        const fatal = run.fatal;
        run.fatal = null;
        throw fatal;
      }
      if (ctx.signal.aborted) return 'aborted';

      run.clicksFailed++;
      const error = toClickError(e);
      this.log(run, 'warn', 'click', `Click failed (${error.code}): ${error.message}`);
      switch (error.code) {
        case 'UNAVAILABLE':
        case 'UNSUPPORTED':
          throw new WorkflowError('CLICK_UNAVAILABLE', error.message, { cause: error });
        case 'NO_TARGET':
        case 'INVALID_REQUEST':
          return 'give-up'; // retrying cannot help
        default:
          // Not confirmed: rescan before trying again, so a click that did land is noticed.
          return 'retry';
      }
    } finally {
      ctx.signal.removeEventListener('abort', link);
    }
  }

  // ---- Navigation --------------------------------------------------------------------------

  private async navigateToTab(
    ctx: ExecutionContext,
    run: RunState,
    tab: TabConfig,
  ): Promise<'ok' | 'unsupported'> {
    const label = tab.label ?? tab.name;
    const attempts = this.config.maxRetriesPerTarget + 1;
    const ignore = this.config.ignoreDiacritics ?? true;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      await this.checkpoint(ctx.signal);
      if (ctx.signal.aborted) return 'ok';
      if (run.clicks >= this.config.maxClicks) {
        throw new WorkflowError('MAX_CLICKS', `Reached the limit of ${this.config.maxClicks} clicks`);
      }

      const before = await this.scan(ctx.signal, run, `navigate:${tab.name}`);
      const matches = findMatches(before.ocr, [label], this.matchOptions()).filter((m) => m.center);
      if (matches.length === 0) {
        throw new WorkflowError('NAVIGATION_FAILED', `Tab label "${label}" was not found on screen`);
      }
      const pick = this.config.tabLabelPick === 'first' ? matches[0] : matches[matches.length - 1];
      const center = pick.center!;
      const beforePrint = fingerprint(before.ocr, [], ignore);
      let latest = before;
      let settled = false;

      const verify = async (): Promise<boolean> => {
        if (!settled) {
          settled = true;
          await sleep(this.config.settleDelayMs, ctx.signal);
        }
        latest = await this.scan(ctx.signal, run, `navigate:${tab.name}`);
        if (tab.verifyKeyword) {
          return findMatches(latest.ocr, [tab.verifyKeyword], this.matchOptions()).length > 0;
        }
        return similarity(beforePrint, fingerprint(latest.ocr, [], ignore)) < 0.95;
      };

      run.clicks++;
      this.log(run, 'info', 'navigate', `Clicking tab "${label}" at (${Math.round(center.x)}, ${Math.round(center.y)}), attempt ${attempt}/${attempts}`);
      try {
        await this.deps.clicker.click({ x: center.x, y: center.y }, { verify, allowRepeat: attempt > 1, signal: ctx.signal });
        run.clicksOk++;
        run.lastScan = latest; // a new tab legitimately looks different
        this.log(run, 'info', 'navigate', `Tab "${tab.name}" is open`);
        return 'ok';
      } catch (e) {
        if (ctx.signal.aborted) return 'ok';
        const error = toClickError(e);
        if (error.code === 'UNSUPPORTED' || error.code === 'UNAVAILABLE' || error.code === 'NO_TARGET') {
          return 'unsupported';
        }
        run.clicksFailed++;
        lastError = error;
        this.log(run, 'warn', 'navigate', `Tab click not confirmed (${error.code}): ${error.message}`);
      }
    }
    throw new WorkflowError('NAVIGATION_FAILED', `Could not open tab "${tab.name}" after ${attempts} attempt(s)`, {
      cause: lastError,
    });
  }

  // ---- Helpers -----------------------------------------------------------------------------

  /** Steps 1-3: capture, OCR, search. */
  private async scan(signal: AbortSignal, run: RunState, context: string): Promise<ScanResult> {
    let uri: string;
    try {
      uri = await this.deps.screen.capture(signal);
    } catch (e) {
      if (signal.aborted) throw e;
      throw new WorkflowError('CAPTURE_FAILED', `Screen capture failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    this.log(run, 'info', 'capture', 'Captured an authorised screen image', { context });

    let result: ScanResult;
    try {
      result = await this.deps.ocr.scan(uri, this.ocrConfig());
    } catch (e) {
      if (signal.aborted) throw e;
      throw new WorkflowError('OCR_FAILED', `OCR failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    this.log(run, 'info', 'ocr', `Recognised ${result.ocr.lines.length} line(s)`);
    this.log(run, 'info', 'find', `${result.targets.length} target(s), ${result.successes.length} success text(s)`);
    return result;
  }

  /** Safeguard: unrelated screen content must stay roughly the same between scans. */
  private checkScreen(run: RunState, previous: ScanResult, next: ScanResult): WorkflowError | null {
    const keywords = [...this.config.targetKeywords, ...this.config.successKeywords];
    const ignore = this.config.ignoreDiacritics ?? true;
    const score = similarity(fingerprint(previous.ocr, keywords, ignore), fingerprint(next.ocr, keywords, ignore));
    if (score >= this.config.minScreenSimilarity) return null;

    const message = `Screen content changed unexpectedly (similarity ${score.toFixed(2)} < ${this.config.minScreenSimilarity})`;
    this.log(run, 'error', 'safeguard', message);
    return new WorkflowError('UNEXPECTED_SCREEN', message);
  }

  private nearCount(matches: TextMatch[], target: TextMatch): number {
    const radius = this.verifyRadius(target);
    return matches.filter((m) => m.center && distance(m.center, target.center!) <= radius).length;
  }

  private verifyRadius(target: TextMatch): number {
    return Math.max(24, (target.box?.height ?? 0) * this.config.verifyRadiusFactor);
  }

  /** Success text must be new and close to the clicked target (or the counts must clearly move). */
  private isRegistered(target: TextMatch, baselineNear: number, before: ScanResult, next: ScanResult): boolean {
    if (this.nearCount(next.successes, target) > baselineNear) return true;
    const radius = this.verifyRadius(target);
    const stillThere = next.targets.some((t) => t.center && distance(t.center, target.center!) <= radius);
    return (
      !stillThere &&
      next.successes.length > before.successes.length &&
      next.targets.length < before.targets.length
    );
  }

  /** A click whose verification timed out may still have landed; confirm it from a later scan. */
  private reconcile(run: RunState, tracker: TargetTracker, scan: ScanResult, rec: TabResult) {
    for (const u of tracker.unconfirmed()) {
      const near = (m: TextMatch) => m.center && distance(m.center, u.center) <= u.radius * 2;
      if (scan.targets.some(near) || !scan.successes.some(near)) continue;
      tracker.markCompleted(u.center);
      rec.registered.push({ text: u.text, center: u.center, attempts: u.attempts, at: this.now() });
      this.log(run, 'info', 'mark', `Confirmed "${u.text}" at (${Math.round(u.center.x)}, ${Math.round(u.center.y)}) from a later scan; not clicking again`);
    }
  }

  private async checkpoint(signal: AbortSignal): Promise<void> {
    while (this.engine.getState() === EngineState.PAUSED && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const done = () => {
          off();
          signal.removeEventListener('abort', done);
          resolve();
        };
        const off = this.engine.subscribe((s) => {
          if (s.state !== EngineState.PAUSED) done();
        });
        signal.addEventListener('abort', done, { once: true });
      });
    }
  }

  private buildResult(): WorkflowResult {
    const run = this.run;
    const snapshot = this.engine.getSnapshot();
    const tabs = run.tabs.map((t) => (t.status === 'running' ? { ...t, status: 'stopped' as const } : t));
    const base = {
      tabs,
      totalClicks: run.clicks,
      clicks: { total: run.clicks, succeeded: run.clicksOk, failed: run.clicksFailed },
      durationMs: this.now() - run.startedAt,
      log: [...run.log],
    };

    switch (snapshot.state) {
      case EngineState.COMPLETED: {
        const anyFailed = tabs.some((t) => t.failed.length > 0);
        const notReached = tabs.some((t) => t.status === 'not-reached');
        if (!anyFailed && !notReached) return { status: 'completed', ...base };
        return {
          status: 'partial',
          reason: notReached ? 'NAVIGATION_UNSUPPORTED' : 'TARGET_FAILED',
          message: run.haltNote,
          ...base,
        };
      }
      case EngineState.STOPPED:
        return run.timedOut
          ? { status: 'timeout', message: `Stopped after ${this.config.maxExecutionMs} ms`, ...base }
          : { status: 'stopped', ...base };
      case EngineState.ERROR: {
        const error = snapshot.error;
        return {
          status: 'failed',
          reason: error instanceof WorkflowError ? error.code : 'ERROR',
          message: error?.message,
          ...base,
        };
      }
      default:
        return { status: 'stopped', message: 'The workflow has not run', ...base };
    }
  }

  private ocrConfig(): OcrSearchConfig {
    return {
      targetKeywords: this.config.targetKeywords,
      successKeywords: this.config.successKeywords,
      ignoreDiacritics: this.config.ignoreDiacritics,
      mode: this.config.mode,
    };
  }

  private matchOptions(): Partial<MatchOptions> {
    return { ignoreDiacritics: this.config.ignoreDiacritics, mode: this.config.mode };
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private log(run: RunState, level: LogLevel, step: string, message: string, data?: Record<string, unknown>) {
    const entry: WorkflowLogEntry = { time: this.now(), level, step, message, data };
    run.log.push(entry);
    try {
      this.deps.onLog?.(entry);
    } catch {
      // A faulty log listener must never break the run.
    }
  }

  private validate(c: WorkflowConfig) {
    if (c.tabs.length === 0) throw new RangeError('At least one tab is required');
    if (cleanKeywords(c.targetKeywords).length === 0) throw new RangeError('At least one target keyword is required');
    if (!Number.isInteger(c.maxRetriesPerTarget) || c.maxRetriesPerTarget < 0) {
      throw new RangeError('maxRetriesPerTarget must be a non-negative integer');
    }
    for (const key of ['maxExecutionMs', 'maxClicks', 'verifyRadiusFactor'] as const) {
      if (!Number.isFinite(c[key]) || c[key] <= 0) throw new RangeError(`${key} must be > 0`);
    }
    if (!Number.isFinite(c.settleDelayMs) || c.settleDelayMs < 0) throw new RangeError('settleDelayMs must be >= 0');
    if (!(c.minScreenSimilarity >= 0 && c.minScreenSimilarity <= 1)) {
      throw new RangeError('minScreenSimilarity must be between 0 and 1');
    }
  }
}
