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
  // "Thứ 2 12/11", "Thứ 2 (3/3)"...: the label as a whole word, with a date or count around it.
  const escaped = want.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const whole = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u');
  return nodes.find((n) => n.text.length <= 60 && whole.test(norm(n.text)));
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
  const { isTarget } = makeMatchers(config);
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
    await clickAll([n]);
  };

  /**
   * Clicks every node in one go: one gesture (up to 20 taps) when the platform supports it, so the
   * pace is set by `clickIntervalMs` and not by bridge round trips.
   */
  // Taps per gesture. A finger on the screen cancels injected gestures, so after a cancel use
  // tiny gestures (they fit between your own touches) and grow back once they succeed.
  let seqMax = MAX_SEQUENCE;
  const clickAll = async (nodes: ScreenNode[]) => {
    if (clicks + nodes.length > config.maxClicks) throw new Stop('failed', 'MAX_CLICKS');
    const centers = nodes.map(center);
    const size = (i: number) => Math.max(nodes[i].w, nodes[i].h);
    try {
      if (deps.tapSequence && config.clickIntervalMs < SLOW_MS) {
        // Fast: batched gestures. Markers can only be refreshed once per batch.
        nodes.forEach((_, i) => deps.onTap?.(clicks + i + 1, centers[i].x, centers[i].y, size(i)));
        clicks += nodes.length;
        for (let i = 0; i < centers.length; i += seqMax) {
          const chunk = centers.slice(i, i + seqMax);
          await deps.tapSequence(chunk.flatMap((c) => [c.x, c.y]), chunk.length, config.clickIntervalMs);
          seqMax = Math.min(MAX_SEQUENCE, seqMax * 2);
        }
      } else {
        // Slow enough to show every click: one tap at a time, marker right before each.
        for (let i = 0; i < centers.length; i++) {
          clicks++;
          deps.onTap?.(clicks, centers[i].x, centers[i].y, size(i));
          await deps.tap(centers[i].x, centers[i].y);
          if (i < centers.length - 1) await wait(config.clickIntervalMs);
        }
      }
    } catch (e) {
      if (e instanceof Stop) throw e; // stop / time limit raised by wait() must not be swallowed
      seqMax = 1;
      // A refused or cancelled gesture did not click; the next round re-checks the screen.
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

  try {
    // With keepWatching the walk over the tabs repeats until stopped: a tab that showed no buttons
    // because its data was still loading gets another look on the next pass.
    for (let pass = 0; pass === 0 || config.keepWatching; pass++)
    for (tabIndex = 0; tabIndex < tabs.length; tabIndex++) {
      const tab = tabs[tabIndex];
      tab.status = 'running';
      progress(`Tab ${tab.name}${pass > 0 ? ` (lượt ${pass + 1})` : ''}`);

      if ((tabIndex > 0 || pass > 0) && !(await openTab(tabIndex))) {
        tab.status = 'failed';
        for (const rest of tabs.slice(tabIndex + 1)) rest.status = 'not-reached';
        progress(`Không tìm thấy tab ${tab.name}`);
        return { status: 'partial', reason: 'TAB_NOT_FOUND', clicks, tabs };
      }

      // Buttons clicked and not yet gone / turned into "Đã đăng ký".
      const pending = new Set<string>();
      // The tab counts as finished only after it has shown no button for `loadWaitMs` in a row,
      // so a list that is still loading from the server is not mistaken for an empty one.
      let emptySince: number | null = null;
      for (;;) {
        const snap = await read();
        const byKey = new Map<string, ScreenNode>();
        for (const n of snap.nodes) if (isTarget(n) && !byKey.has(keyOf(n))) byKey.set(keyOf(n), n);
        for (const k of [...pending]) {
          if (!byKey.has(k)) {
            pending.delete(k);
            tab.registered++;
          }
        }
        if (byKey.size === 0) {
          emptySince ??= deps.now();
          if (deps.now() - emptySince >= config.loadWaitMs) break;
          progress(`Chờ dữ liệu ${tab.name}…`);
          await wait(Math.max(config.settleMs, config.pollMs));
          continue;
        }
        emptySince = null;
        for (const k of byKey.keys()) pending.add(k);
        progress(`Click ${byKey.size} nút trong ${tab.name}`);
        // Click everything that is on screen, over and over, until the buttons are gone.
        await clickAll([...byKey.values()]);
        await wait(config.clickIntervalMs);
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
const MAX_POINT_CLICKS = 10_000_000;
/** Taps per gesture (Android allows 20 strokes). */
const MAX_SEQUENCE = 20;
/** A batch lasts about this long, which is also the longest a Stop can take to be noticed. */
const BATCH_MS = 300;
/** Assumed duration of one tap, for sizing batches. */
const TAP_MS = 10;
/** From this delay up, every click is sent and shown on its own (no batching). */
const SLOW_MS = 100;

export type PointsDeps = Pick<RunnerDeps, 'snapshot' | 'tap' | 'tapSequence' | 'sleep' | 'onTap' | 'onProgress'>;

/**
 * Taps the saved points in order and starts over (1 -> 2 -> ... -> 1 -> ...), `pointRounds` times
 * (0 = until stopped), `pointIntervalMs` between taps. Never taps while FlyClick itself is in front.
 * With `tapSequence` many taps go out in one gesture, which is what makes it fast.
 */
export async function runPoints(
  deps: PointsDeps,
  config: Pick<AutoConfig, 'points' | 'pointIntervalMs' | 'pointRounds'>,
  signal: AbortSignal,
): Promise<RunResult> {
  let clicks = 0;
  const progress = (message: string) => deps.onProgress?.({ tabIndex: 0, tabs: [], clicks, message });
  const result = (status: RunResult['status'], reason?: string): RunResult => ({ status, reason, clicks, tabs: [] });

  const { points } = config;
  const n = points.length;
  if (n === 0) return result('failed', 'NO_POINTS');
  const limit = config.pointRounds === 0 ? MAX_POINT_CLICKS : config.pointRounds * n;
  const perBatch =
    config.pointIntervalMs >= SLOW_MS
      ? 1
      : Math.max(1, Math.min(MAX_SEQUENCE, Math.floor(BATCH_MS / (config.pointIntervalMs + TAP_MS))));

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

  let cap = perBatch; // shrinks after a cancelled gesture, grows back after successes
  while (clicks < limit) {
    // Checking the screen costs time, so do it once per batch rather than per tap.
    if (!(await inOtherApp()) || signal.aborted) return result('stopped', 'USER_STOPPED');
    const start = clicks % n;
    const useSeq = !!deps.tapSequence && config.pointIntervalMs < SLOW_MS;
    const count = useSeq ? Math.min(cap, limit - clicks) : 1;
    const batch = Array.from({ length: count }, (_, i) => points[(start + i) % n]);
    for (let i = 0; i < Math.min(count, n); i++) deps.onTap?.(clicks + i + 1, batch[i].x, batch[i].y, 0);
    try {
      if (useSeq) {
        await deps.tapSequence!(batch.flatMap((p) => [p.x, p.y]), count, config.pointIntervalMs);
      } else {
        await deps.tap(batch[0].x, batch[0].y);
      }
      clicks += count;
      cap = Math.min(perBatch, cap * 2);
      progress(`Vòng ${Math.floor((clicks - 1) / n) + 1}`);
    } catch (e) {
      // Android cancels injected taps while a finger is on the screen: retry with tiny gestures.
      cap = 1;
      progress(`Chờ bạn thả tay / Android hủy chạm: ${e instanceof Error ? e.message : String(e)}`);
      await deps.sleep(30, signal);
    }
    // With tapSequence the gap is already inside the gesture.
    if (!useSeq && config.pointIntervalMs > 0) await deps.sleep(config.pointIntervalMs, signal);
  }
  return result('completed');
}
