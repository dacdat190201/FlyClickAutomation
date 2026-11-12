import type { KeyValueStore } from '../storage/key-value-store';
import { DEFAULT_AUTO_CONFIG, type AutoConfig, type ClickPoint } from './types';

const KEY = 'flyclick.auto-config.v3';
const OLD_KEY = 'flyclick.auto-config.v2';

/** "Thứ 2, Thứ 3" or one per line -> ["Thứ 2", "Thứ 3"]. */
export function parseList(text: string): string[] {
  return text
    .split(/[\n,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const strings = (v: unknown, fallback: string[]) =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length > 0 ? (v as string[]) : fallback;
const pointList = (v: unknown): ClickPoint[] =>
  Array.isArray(v)
    ? v.filter(
        (p): p is ClickPoint =>
          !!p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0,
      )
    : [];
const num = (v: unknown, fallback: number, min: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min ? v : fallback;

/** Reads the saved config; anything missing or invalid falls back to the defaults. */
export async function loadAutoConfig(store: KeyValueStore): Promise<AutoConfig> {
  try {
    const raw = (await store.get(KEY)) ?? (await store.get(OLD_KEY));
    if (!raw) return DEFAULT_AUTO_CONFIG;
    const migrated = !(await store.get(KEY));
    const v = JSON.parse(raw) as Partial<Record<keyof AutoConfig, unknown>>;
    const d = DEFAULT_AUTO_CONFIG;
    return {
      mode: v.mode === 'points' ? 'points' : 'register',
      points: pointList(v.points),
      pointIntervalMs: num(v.pointIntervalMs, d.pointIntervalMs, 0),
      clickIntervalMs: num(v.clickIntervalMs, d.clickIntervalMs, 0),
      // v2 defaulted to a single round, which stopped after one click: start over from "until stopped".
      pointRounds: migrated ? d.pointRounds : num(v.pointRounds, d.pointRounds, 0),
      tabs: strings(v.tabs, d.tabs),
      targetKeywords: strings(v.targetKeywords, d.targetKeywords),
      successKeywords: strings(v.successKeywords, d.successKeywords),
      maxRetriesPerTarget: num(v.maxRetriesPerTarget, d.maxRetriesPerTarget, 0),
      keepWatching: typeof v.keepWatching === 'boolean' ? v.keepWatching : d.keepWatching,
      maxRunMs: d.maxRunMs,
      maxClicks: d.maxClicks,
      settleMs: num(v.settleMs, d.settleMs, 0),
      verifyMs: num(v.verifyMs, d.verifyMs, 0),
      pollMs: num(v.pollMs, d.pollMs, 10),
      tapMs: num(v.tapMs, d.tapMs, 1),
      showMarkers: typeof v.showMarkers === 'boolean' ? v.showMarkers : d.showMarkers,
    };
  } catch {
    return DEFAULT_AUTO_CONFIG;
  }
}

export function saveAutoConfig(store: KeyValueStore, config: AutoConfig): Promise<void> {
  return store.set(KEY, JSON.stringify(config));
}
