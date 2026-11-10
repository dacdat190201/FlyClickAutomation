import { HistoryStore } from '@/history';
import { SettingsStore } from '@/settings';
import { AsyncStorageKeyValueStore } from '@/storage/key-value-store';

/** App-wide instances, persisted on the device with AsyncStorage. */
const storage = new AsyncStorageKeyValueStore();

export const settingsStore = new SettingsStore(storage);
export const historyStore = new HistoryStore(storage);
