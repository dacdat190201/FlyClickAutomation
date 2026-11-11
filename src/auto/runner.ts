import { normalize } from '../ocr/normalize';
import type {
  AutoConfig,
  RunnerDeps,
  RunResult,
  ScreenNode,
  ScreenSnapshot,
  TabResult,
} from './types';

class Stop extends Error {
  constructor(
    readonly kind: 'stopped' | 'timeout' | 'failed',
    readonly reason: string,
  ) {
    super(reason);
  }
}

const norm = (s: string) => normalize(s, true).text;
const center = (n: ScreenNode) => ({ x: Math.round(n.x + n.w / 2), y: Math.round(n.y + n.h / 2) });
/** Position bucket, so a button is recognised again after a rescan. */
const keyOf = (n: ScreenNode) => {
  const c = center(n);
  return `${Math.round(c.x / 24)},${Math.round(c.y / 24)}`;
};

export function makeMatchers(config: Pick<AutoConfig, 'targetKeywords' | 'successKeywords'>) {
  const targets = config.targetKeywords.map(norm).filter(Boolean);
  const successes = config.successKeywords.map(norm).filter(Boolean);
  const isSuccess = (n: ScreenNode) => {
    const t = norm(n.text);
    return successes.some((k) => t.includes(k));
  };
  // "Đã đăng ký" contains "đăng ký", so success text must be excluded from the targets.
  const isTarget = (n: ScreenNode) => {
    const t = norm(n.text);
    return !isSuccess(n) && targets.some((k) => t.includes(k));
  };
  return { isTarget, isSuccess };
}

export function findTab(nodes: ScreenNode[], label: string): ScreenNode | undefined {
  const want = norm(label);
  const exact = nodes.find((n) => norm(n.text) === want);
  if (exact) return exact;
  return nodes.find((n) => norm(n.text).includes(want) && n.text.length <= label.length + 8);
}

/**
 * Walks the tabs in order. On each tab it clicks every "Đăng ký" button and checks that it
 * turned into "Đã đăng ký" (or disappeared) before moving on; then it opens the next tab.
 */
export async function runAutomation(
  deps: RunnerDeps,
  config: AutoConfig,
  signal: AbortSignal,
): Promise<RunResult> {
  const startedAt = deps.now();
  const { isTarget, isSuccess } = makeMatchers(config);
  const tabs: TabResult[] = config.tabs.map((name) => ({
    name,
    status: 'pending',
    registered: 0,
    failed: 0,
  }));
  let clicks = 0;
  let tabIndex = 0;

  const progress = (message: string) =>
    deps.onProgress?.({ tabIndex, tabs: tabs.map((t) => ({ ...t })), clicks, message });
  const check = () => {
    if (signal.aborted) throw new Stop('stopped', 'USER_STOPPED');
    if (deps.now() - startedAt > config.maxRunMs) throw new Stop('timeout', 'MAX_TIME');
  };
  const wait = async (ms: number) => {
    await deps.sleep(ms, signal);
    check();
  };

  /** Reads the screen of the other app. Waits while FlyClick itself is in front. */
  const read = async (): Promise<ScreenSnapshot> => {
    for (;;) {
      check();
      const snap = deps.snapshot();
      if (snap && snap.pkg && snap.pkg !== snap.self) return snap;
      progress(snap ? 'Hãy mở app cần đăng ký' : 'Đang chờ màn hình…');
      await wait(config.pollMs * 2);
    }
  };

  const tap = async (n: ScreenNode) => {
    if (clicks >= config.maxClicks) throw new Stop('failed', 'MAX_CLICKS');
    clicks++;
    const { x, y } = center(n);
    deps.onTap?.(clicks, x, y);
    try {
      await deps.tap(x, y);
    } catch (e) {
      // A refused or cancelled gesture did not click; the caller re-checks the screen.
      progress(`Click không thực hiện được: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Texts in the same row as `anchor`: changes when the tab bar scrolls. */
  const rowSignature = (nodes: ScreenNode[], anchor: ScreenNode) =>
    nodes
      .filter((n) => Math.abs(center(n).y - center(anchor).y) <= anchor.h)
      .map((n) => n.text)
      .join('|');

  /** Another configured tab that is on screen: it tells us which row is the tab bar. */
  const anchorFor = (nodes: ScreenNode[], index: number): ScreenNode | undefined => {
    const order = [...tabs.slice(0, index).reverse(), ...tabs.slice(index + 1)];
    for (const other of order) {
      const hit = findTab(nodes, other.name);
      if (hit) return hit;
    }
    return undefined;
  };

  /**
   * Opens a tab. If its label is not on screen the tab bar is probably scrolled: swipe it to the
   * left (towards later tabs) until the screen stops changing, then to the right, then give up.
   */
  const openTab = async (index: number): Promise<boolean> => {
    const label = tabs[index].name;
    let reversed = false;
    let previous: string | null = null;
    let lastAnchor: ScreenNode | undefined; // the tab bar row, remembered after it scrolls away
    for (let attempt = 0; attempt < 40; attempt++) {
      const snap = await read();
      const tab = findTab(snap.nodes, label);
      if (tab) {
        progress(`Mở tab ${label}`);
        await tap(tab);
        await wait(Math.max(config.settleMs * 2, 250)); // a tab switch needs time to draw
        return true;
      }
      const anchor = anchorFor(snap.nodes, index) ?? lastAnchor;
      lastAnchor = anchor;
      if (!anchor || attempt < 2) {
        // Maybe still loading: look again before scrolling.
        if (!anchor && attempt >= 4) return false;
        await wait(config.pollMs * 2);
        continue;
      }
      const signature = rowSignature(snap.nodes, anchor);
      if (previous !== null && signature === previous) {
        // The last swipe changed nothing: the end of the tab bar.
        if (reversed) return false;
        reversed = true;
      }
      previous = signature;
      const width = Math.max(...snap.nodes.map((n) => n.x + n.w));
      const y = center(anchor).y;
      const [from, to] = reversed ? [width * 0.2, width * 0.8] : [width * 0.8, width * 0.2];
      progress(`Cuộn thanh tab để tìm ${label}`);
      try {
        await deps.swipe(Math.round(from), y, Math.round(to), y);
      } catch {
        // A refused swipe changes nothing; the signature check above ends the search.
      }
      await wait(Math.max(config.settleMs * 2, 350)); // let the fling settle
    }
    return false;
  };

  /**
   * Clicks one target (found in `seen`) and checks the screen right away, again and again, until
   * it shows proof or `verifyMs` passes. Returns the last screen so the caller need not rescan.
   */
  const registerOne = async (
    target: ScreenNode,
    seen: ScreenSnapshot,
  ): Promise<{ ok: boolean; snap: ScreenSnapshot }> => {
    const before = seen.nodes.filter(isSuccess).length;
    await tap(target);
    if (config.settleMs > 0) await wait(config.settleMs);
    const deadline = deps.now() + config.verifyMs;
    for (;;) {
      const snap = await read();
      const stillThere = snap.nodes.some((n) => isTarget(n) && keyOf(n) === keyOf(target));
      if (!stillThere || snap.nodes.filter(isSuccess).length > before) return { ok: true, snap };
      if (deps.now() >= deadline) return { ok: false, snap };
      await wait(config.pollMs);
    }
  };

  try {
    for (tabIndex = 0; tabIndex < tabs.length; tabIndex++) {
      const tab = tabs[tabIndex];
      tab.status = 'running';
      progress(`Tab ${tab.name}`);

      if (tabIndex > 0 && !(await openTab(tabIndex))) {
        tab.status = 'failed';
        for (const rest of tabs.slice(tabIndex + 1)) rest.status = 'not-reached';
        progress(`Không tìm thấy tab ${tab.name}`);
        return { status: 'partial', reason: 'TAB_NOT_FOUND', clicks, tabs };
      }

      const attempts = new Map<string, number>();
      const givenUp = new Set<string>();
      let emptyScans = 0;
      let carried: ScreenSnapshot | null = null;
      while (emptyScans < 2) {
        const snap: ScreenSnapshot = carried ?? (await read());
        carried = null;
        const target = snap.nodes.find((n) => isTarget(n) && !givenUp.has(keyOf(n)));
        if (!target) {
          // Confirm twice: the list may still be loading or redrawing after the last click.
          emptyScans++;
          await wait(Math.max(config.settleMs, config.pollMs));
          continue;
        }
        emptyScans = 0;
        const key = keyOf(target);
        const n = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, n);
        progress(`Click "${target.text}" (lần ${n})`);
        const outcome = await registerOne(target, snap);
        carried = outcome.snap;
        if (outcome.ok) {
          tab.registered++;
          progress(`Đã đăng ký ${tab.registered} mục trong ${tab.name}`);
        } else if (n > config.maxRetriesPerTarget) {
          givenUp.add(key);
          tab.failed++;
          progress(`Bỏ qua một nút sau ${n} lần thử`);
        }
      }
      tab.status = tab.failed > 0 ? 'failed' : 'done';
    }
  } catch (e) {
    if (e instanceof Stop) {
      for (const t of tabs) if (t.status === 'running' || t.status === 'pending') t.status = 'not-reached';
      progress(e.reason);
      return { status: e.kind, reason: e.reason, clicks, tabs };
    }
    throw e;
  }

  const failed = tabs.some((t) => t.status === 'failed');
  progress(failed ? 'Xong, một số nút không đăng ký được' : 'Hoàn tất');
  return { status: failed ? 'partial' : 'completed', clicks, tabs };
}

/** Hard stop for a point run, so "until stopped" can still never run away. */
const MAX_POINT_CLICKS = 100_000;

export type PointsDeps = Pick<RunnerDeps, 'snapshot' | 'tap' | 'sleep' | 'onTap' | 'onProgress'>;

/**
 * Taps the saved points in order, `pointRounds` times (0 = until stopped), pausing
 * `pointIntervalMs` after each. Never taps while FlyClick itself is in front.
 */
export async function runPoints(
  deps: PointsDeps,
  config: Pick<AutoConfig, 'points' | 'pointIntervalMs' | 'pointRounds'>,
  signal: AbortSignal,
): Promise<RunResult> {
  let clicks = 0;
  const progress = (message: string) => deps.onProgress?.({ tabIndex: 0, tabs: [], clicks, message });
  const result = (status: RunResult['status'], reason?: string): RunResult => ({ status, reason, clicks, tabs: [] });

  if (config.points.length === 0) return result('failed', 'NO_POINTS');

  /** True once another app is in front; false if stopped while waiting. */
  const inOtherApp = async (): Promise<boolean> => {
    for (;;) {
      if (signal.aborted) return false;
      const snap = deps.snapshot();
      if (snap && snap.pkg && snap.pkg !== snap.self) return true;
      progress('Hãy mở app cần click');
      await deps.sleep(200, signal);
    }
  };

  for (let round = 0; config.pointRounds === 0 || round < config.pointRounds; round++) {
    for (const point of config.points) {
      // Checking the screen costs time, so do it every few taps rather than every one.
      if (clicks % 5 === 0 && !(await inOtherApp())) return result('stopped', 'USER_STOPPED');
      if (signal.aborted) return result('stopped', 'USER_STOPPED');
      if (clicks >= MAX_POINT_CLICKS) return result('failed', 'MAX_CLICKS');
      clicks++;
      deps.onTap?.(clicks, point.x, point.y);
      try {
        await deps.tap(point.x, point.y);
        progress(`Vòng ${round + 1}`);
      } catch (e) {
        progress(`Click không thực hiện được: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (config.pointIntervalMs > 0) await deps.sleep(config.pointIntervalMs, signal);
    }
  }
  return result('completed');
}
