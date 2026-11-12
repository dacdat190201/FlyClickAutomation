export type ScreenNode = { text: string; x: number; y: number; w: number; h: number; clickable: boolean };
export type ScreenSnapshot = { pkg: string; self: string; nodes: ScreenNode[] };

export type Mode = 'register' | 'points';
export type ClickPoint = { x: number; y: number };

export type AutoConfig = {
  /** `register`: find text and click it. `points`: click saved positions in order. */
  mode: Mode;
  /** Saved click positions (screen pixels), in click order. */
  points: ClickPoint[];
  /** Pause after each point. */
  pointIntervalMs: number;
  /** Register mode: pause between two rounds of clicking every matching button on screen. */
  clickIntervalMs: number;
  /** Rounds through all points; 0 = until stopped. */
  pointRounds: number;
  /** Tab labels in order, e.g. ["Thứ 2", "Thứ 3"]. The first is assumed to be open already. */
  tabs: string[];
  /** Button text to click, e.g. "Đăng ký". */
  targetKeywords: string[];
  /** Text that proves it worked, e.g. "Đã đăng ký". */
  successKeywords: string[];
  /** Extra attempts per button after the first one. */
  maxRetriesPerTarget: number;
  /** How long a tab must show no button before moving on (its list may still be loading). */
  loadWaitMs: number;
  /** Repeat the walk over all tabs until stopped (also clicks buttons after you switch tabs yourself). */
  keepWatching: boolean;
  /** Hard limits so a run always ends. */
  maxRunMs: number;
  maxClicks: number;
  /** Wait after a click before checking the screen again. */
  settleMs: number;
  /** How long to wait for a click to show its result before it counts as a failed attempt. */
  verifyMs: number;
  /** Pause between screen checks. */
  pollMs: number;
  /** How long the finger stays down per tap. */
  tapMs: number;
  /** Flash a ring with the click number where each tap is sent. */
  showMarkers: boolean;
};

export type Speed = 'fast' | 'normal' | 'safe';

/** Timing presets. Faster = fewer pauses between a click and the next screen check. */
export const SPEED_PRESETS: Record<Speed, Pick<AutoConfig, 'settleMs' | 'verifyMs' | 'pollMs' | 'tapMs'>> = {
  fast: { settleMs: 0, verifyMs: 700, pollMs: 40, tapMs: 10 },
  normal: { settleMs: 150, verifyMs: 1500, pollMs: 120, tapMs: 20 },
  safe: { settleMs: 400, verifyMs: 2500, pollMs: 400, tapMs: 50 },
};

export function speedOf(c: Pick<AutoConfig, 'settleMs' | 'verifyMs' | 'pollMs' | 'tapMs'>): Speed | null {
  const hit = (Object.keys(SPEED_PRESETS) as Speed[]).find((k) => {
    const p = SPEED_PRESETS[k];
    return p.settleMs === c.settleMs && p.verifyMs === c.verifyMs && p.pollMs === c.pollMs && p.tapMs === c.tapMs;
  });
  return hit ?? null;
}

export const DEFAULT_AUTO_CONFIG: AutoConfig = {
  mode: 'register',
  points: [],
  pointIntervalMs: 10,
  clickIntervalMs: 10,
  pointRounds: 0,
  tabs: ['Thứ 2', 'Thứ 3'],
  targetKeywords: ['Đăng ký'],
  successKeywords: ['Đã đăng ký'],
  maxRetriesPerTarget: 5,
  loadWaitMs: 1500,
  keepWatching: true,
  maxRunMs: 4 * 60 * 60_000,
  maxClicks: 1_000_000,
  ...SPEED_PRESETS.fast,
  showMarkers: true,
};

export type TabStatus = 'pending' | 'running' | 'done' | 'failed' | 'not-reached';
export type TabResult = { name: string; status: TabStatus; registered: number; failed: number };

export type RunStatus = 'completed' | 'partial' | 'stopped' | 'timeout' | 'failed';
export type RunResult = {
  status: RunStatus;
  reason?: string;
  clicks: number;
  tabs: TabResult[];
};

export type RunProgress = {
  tabIndex: number;
  tabs: TabResult[];
  clicks: number;
  message: string;
};

export type RunnerDeps = {
  /** Current window text, or null when unavailable. */
  snapshot(): ScreenSnapshot | null;
  /** Taps a screen pixel. Rejects on failure. */
  tap(x: number, y: number): Promise<void>;
  /** Swipes between two screen pixels (scrolls the tab bar). Rejects on failure. */
  swipe(x1: number, y1: number, x2: number, y2: number): Promise<void>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  now(): number;
  /**
   * Several taps as one gesture (taps cycle through `flat` = x1,y1,x2,y2,...), `gapMs` apart.
   * Optional: without it the runner falls back to one `tap` per click.
   */
  tapSequence?(flat: number[], count: number, gapMs: number): Promise<void>;
  /** Called right before a tap with the running click count; `size` is the target's size in px (0 = unknown). */
  onTap?(count: number, x: number, y: number, size: number): void;
  onProgress?(p: RunProgress): void;
};
