import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_AUTO_CONFIG,
  loadAutoConfig,
  runAutomation,
  runPoints,
  saveAutoConfig,
} from '@/auto';
import type { AutoConfig, ClickPoint, RunProgress, RunResult, RunnerDeps } from '@/auto';
import { loadAndroidNativeModule } from '@/click/native/android-native';
import { useHistory } from '@/providers/app-providers';
import { AsyncStorageKeyValueStore } from '@/storage/key-value-store';

const storage = new AsyncStorageKeyValueStore();

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}

export type StartFailure = 'unsupported' | 'service-off' | 'no-points' | null;

const flatten = (points: ClickPoint[]) => points.flatMap((p) => [p.x, p.y]);

/**
 * Runs the automation against whatever app is in front (Android only), in one of two modes:
 * find text and click it (`register`), or click saved screen positions (`points`).
 * `start()` resolves a failure code when it cannot begin; otherwise null.
 */
export function useAutoRunner() {
  const native = useRef(loadAndroidNativeModule()).current;
  const { add: addHistory } = useHistory();
  const [config, setConfigState] = useState<AutoConfig>(DEFAULT_AUTO_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const configRef = useRef(config);
  configRef.current = config;
  const abortRef = useRef<AbortController | null>(null);
  const pickerRef = useRef(false);

  useEffect(() => {
    let alive = true;
    loadAutoConfig(storage).then((c) => {
      if (!alive) return;
      configRef.current = c;
      setConfigState(c);
      setLoaded(true);
    });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, []);

  const setConfig = useCallback(
    (next: AutoConfig) => {
      configRef.current = next;
      setConfigState(next);
      saveAutoConfig(storage, next).catch(() => undefined);
      if (pickerRef.current) native?.setPointDots(flatten(next.points));
    },
    [native],
  );

  const closePicker = useCallback(() => {
    if (!pickerRef.current) return;
    pickerRef.current = false;
    setPickerOpen(false);
    native?.hidePointPicker();
    native?.setFloatingStatus('0');
  }, [native]);

  /** Opens the crosshair picker over the other app, or closes it if it is already open. */
  const togglePicker = useCallback(async (): Promise<StartFailure> => {
    if (pickerRef.current) {
      closePicker();
      return null;
    }
    if (!native) return 'unsupported';
    if (!native.isServiceEnabled()) return 'service-off';
    if (abortRef.current) return null; // not while running
    if (!(await native.showPointPicker())) return 'service-off';
    pickerRef.current = true;
    setPickerOpen(true);
    native.setPointDots(flatten(configRef.current.points));
    native.setFloatingStatus(`📍${configRef.current.points.length}`);
    return null;
  }, [native, closePicker]);

  // "Lưu" / "Xong" on the crosshair.
  useEffect(() => {
    if (!native) return;
    const sub = native.addListener('onPointPicker', ({ action, x, y }) => {
      if (action === 'done') return closePicker();
      const next = {
        ...configRef.current,
        points: [...configRef.current.points, { x: Math.round(x), y: Math.round(y) }],
      };
      setConfig(next);
      native.setFloatingStatus(`📍${next.points.length}`);
    });
    return () => {
      sub.remove();
      native.hidePointPicker();
    };
  }, [native, closePicker, setConfig]);

  const start = useCallback(async (): Promise<StartFailure> => {
    if (abortRef.current) return null; // already running
    if (!native) return 'unsupported';
    if (!native.isServiceEnabled()) return 'service-off';
    const mode = configRef.current.mode;
    if (mode === 'points' && configRef.current.points.length === 0) return 'no-points';

    closePicker();
    const abort = new AbortController();
    abortRef.current = abort;
    setRunning(true);
    setResult(null);
    setProgress(null);
    native.setFloatingStatus('0');
    const startedAt = Date.now();

    const deps: RunnerDeps = {
      snapshot: () => native.snapshot(),
      tap: async (x, y) => {
        if (!(await native.tap(x, y, configRef.current.tapMs))) throw new Error('Android đã hủy thao tác chạm');
      },
      swipe: async (x1, y1, x2, y2) => {
        if (!(await native.swipe(x1, y1, x2, y2, 300))) throw new Error('Android đã hủy thao tác vuốt');
      },
      onTap: (count, x, y) => {
        native.setFloatingStatus(String(count));
        if (configRef.current.showMarkers) native.showTapMarker(x, y, String(count));
      },
      sleep: abortableSleep,
      now: Date.now,
      onProgress: setProgress,
    };

    try {
      const res =
        mode === 'points'
          ? await runPoints(deps, configRef.current, abort.signal)
          : await runAutomation(deps, configRef.current, abort.signal);
      setResult(res);
      const registered = res.tabs.reduce((n, t) => n + t.registered, 0);
      const failed = res.tabs.reduce((n, t) => n + t.failed, 0);
      await addHistory({
        kind: mode === 'points' ? 'macro' : 'workflow',
        name:
          mode === 'points'
            ? `Click theo điểm: ${res.clicks} lần (${configRef.current.points.length} điểm)`
            : `Đăng ký tự động: ${registered} mục (${res.tabs.length} tab)`,
        startedAt,
        durationMs: Date.now() - startedAt,
        status: res.status === 'completed' ? 'success' : res.status === 'stopped' ? 'stopped' : 'failed',
        clicks: { total: res.clicks, succeeded: mode === 'points' ? res.clicks : registered, failed },
        error: res.reason && res.status !== 'stopped' ? { code: res.reason, message: res.reason } : undefined,
      }).catch(() => undefined);
    } catch (e) {
      setResult({ status: 'failed', reason: e instanceof Error ? e.message : String(e), clicks: 0, tabs: [] });
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
    return null;
  }, [native, addHistory, closePicker]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const openAccessibilitySettings = useCallback(() => native?.openAccessibilitySettings(), [native]);

  return {
    config,
    loaded,
    setConfig,
    running,
    progress,
    result,
    start,
    stop,
    pickerOpen,
    togglePicker,
    openAccessibilitySettings,
  };
}
