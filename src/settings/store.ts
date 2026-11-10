import { SerialQueue, type KeyValueStore } from '../storage/key-value-store';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, type Settings } from './types';
import { parseSettings, validatePatch } from './validation';

export const SETTINGS_STORAGE_KEY = 'flyclick.settings.v1';

export type SettingsListener = (settings: Settings) => void;

/**
 * Settings saved on the device. Reads fall back to defaults field by field; writes are validated,
 * serialised, and only become visible once they are saved.
 */
export class SettingsStore {
  private readonly storage: KeyValueStore;
  private readonly key: string;
  private readonly queue = new SerialQueue();
  private readonly listeners = new Set<SettingsListener>();
  private current: Settings = { ...DEFAULT_SETTINGS };

  constructor(storage: KeyValueStore, key = SETTINGS_STORAGE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  get(): Settings {
    return this.current;
  }

  /** Loads the saved settings. Never throws on bad data: defaults are used and issues returned. */
  load(): Promise<{ issues: string[] }> {
    return this.queue.run(async () => {
      let raw: unknown;
      const issues: string[] = [];
      try {
        const text = await this.storage.get(this.key);
        raw = text === null ? undefined : JSON.parse(text);
      } catch (e) {
        issues.push(`Could not read saved settings (${e instanceof Error ? e.message : String(e)}); using defaults`);
      }
      const parsed = parseSettings(raw);
      this.current = parsed.settings;
      this.notify();
      return { issues: [...issues, ...parsed.issues] };
    });
  }

  /** Applies and saves a change. Throws `SettingsError` for invalid values; nothing changes then. */
  update(patch: Partial<Settings>): Promise<Settings> {
    const clean = validatePatch(patch);
    return this.queue.run(async () => {
      const next = { ...this.current, ...clean };
      await this.save(next);
      this.current = next;
      this.notify();
      return next;
    });
  }

  reset(): Promise<Settings> {
    return this.queue.run(async () => {
      const next = { ...DEFAULT_SETTINGS };
      await this.save(next);
      this.current = next;
      this.notify();
      return next;
    });
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private save(settings: Settings): Promise<void> {
    return this.storage.set(this.key, JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, ...settings }));
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.current);
      } catch {
        // A faulty listener must not break settings.
      }
    }
  }
}
