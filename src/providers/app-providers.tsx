import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';

import type { HistoryRecord, HistorySummary, NewHistoryRecord } from '@/history';
import { DEFAULT_SETTINGS, type Settings } from '@/settings';

import { historyStore, settingsStore } from './stores';

// ---- Settings ------------------------------------------------------------------------------

type SettingsContextValue = {
  settings: Settings;
  /** Saves a change. Rejects with `SettingsError` for invalid values. */
  update: (patch: Partial<Settings>) => Promise<Settings>;
  reset: () => Promise<Settings>;
};

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  update: async () => DEFAULT_SETTINGS,
  reset: async () => DEFAULT_SETTINGS,
});

export const useSettings = () => useContext(SettingsContext);

function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(settingsStore.get());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    const off = settingsStore.subscribe((next) => alive && setSettings(next));
    settingsStore
      .load()
      .catch(() => undefined) // defaults are used if storage is unavailable
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // The theme preference drives the system appearance, so every `useColorScheme()` follows it.
  useEffect(() => {
    try {
      Appearance.setColorScheme(settings.theme === 'system' ? 'unspecified' : settings.theme);
    } catch {
      // Not supported on this platform.
    }
  }, [settings.theme]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      settings,
      update: (patch) => settingsStore.update(patch),
      reset: () => settingsStore.reset(),
    }),
    [settings],
  );

  // Wait for the saved settings so the first frame already has the right theme.
  if (!ready) return null;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

// ---- History -------------------------------------------------------------------------------

type HistoryContextValue = {
  records: readonly HistoryRecord[];
  summary: HistorySummary;
  loaded: boolean;
  add: (record: NewHistoryRecord) => Promise<HistoryRecord>;
  remove: (id: string) => Promise<boolean>;
  clear: () => Promise<void>;
};

const EMPTY_SUMMARY = historyStore.summary();

const HistoryContext = createContext<HistoryContextValue>({
  records: [],
  summary: EMPTY_SUMMARY,
  loaded: false,
  add: (record) => historyStore.add(record),
  remove: (id) => historyStore.remove(id),
  clear: () => historyStore.clear(),
});

export const useHistory = () => useContext(HistoryContext);

function HistoryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ records: readonly HistoryRecord[]; summary: HistorySummary; loaded: boolean }>({
    records: [],
    summary: EMPTY_SUMMARY,
    loaded: false,
  });

  useEffect(() => {
    let alive = true;
    const publish = (loaded: boolean) =>
      alive && setState({ records: historyStore.list(), summary: historyStore.summary(), loaded });
    const off = historyStore.subscribe(() => publish(true));
    historyStore
      .load()
      .catch(() => undefined)
      .finally(() => publish(true));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const add = useCallback((record: NewHistoryRecord) => historyStore.add(record), []);
  const remove = useCallback((id: string) => historyStore.remove(id), []);
  const clear = useCallback(() => historyStore.clear(), []);
  const value = useMemo(() => ({ ...state, add, remove, clear }), [state, add, remove, clear]);

  return <HistoryContext.Provider value={value}>{children}</HistoryContext.Provider>;
}

/** Settings and history for the whole app. Place once, near the root. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <HistoryProvider>{children}</HistoryProvider>
    </SettingsProvider>
  );
}
