import { SerialQueue, type KeyValueStore } from '../storage/key-value-store';
import { matchesFilter, sanitizeRecord, summarize } from './records';
import {
  HISTORY_LIMITS,
  HISTORY_SCHEMA_VERSION,
  type HistoryFilter,
  type HistoryRecord,
  type HistorySummary,
  type NewHistoryRecord,
} from './types';

export const HISTORY_STORAGE_KEY = 'flyclick.history.v1';

export type HistoryListener = (records: readonly HistoryRecord[]) => void;

export type HistoryEnv = { newId(): string };

let counter = 0;
const defaultEnv: HistoryEnv = {
  newId: () => {
    counter = (counter + 1) % 1_000_000;
    return `run_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  },
};

export type HistoryLoadResult = { loaded: number; dropped: number; issues: string[] };

/**
 * Execution history kept on the device, newest first. Bounded (oldest records are dropped),
 * written one operation at a time, and changed in memory only after the write succeeded.
 */
export class HistoryStore {
  private readonly storage: KeyValueStore;
  private readonly key: string;
  private readonly maxRecords: number;
  private readonly env: HistoryEnv;
  private readonly queue = new SerialQueue();
  private readonly listeners = new Set<HistoryListener>();
  private records: HistoryRecord[] = [];

  constructor(
    storage: KeyValueStore,
    options: { key?: string; maxRecords?: number; env?: HistoryEnv } = {},
  ) {
    this.storage = storage;
    this.key = options.key ?? HISTORY_STORAGE_KEY;
    this.maxRecords = options.maxRecords ?? HISTORY_LIMITS.maxRecords;
    this.env = options.env ?? defaultEnv;
  }

  /**
   * Loads saved history. Unreadable data never crashes the app: if the stored text is not valid
   * JSON it is copied to `<key>.corrupt` (not deleted) and history starts empty.
   */
  load(): Promise<HistoryLoadResult> {
    return this.queue.run(async () => {
      const issues: string[] = [];
      let dropped = 0;
      this.records = [];

      let text: string | null = null;
      try {
        text = await this.storage.get(this.key);
      } catch (e) {
        issues.push(`Could not read history: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (text !== null) {
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          issues.push('Saved history was not valid JSON; it was set aside and history starts empty');
          await this.storage.set(`${this.key}.corrupt`, text).catch(() => undefined);
        }
        const list = (data as { records?: unknown } | undefined)?.records;
        if (Array.isArray(list)) {
          const seen = new Set<string>();
          for (const raw of list) {
            const record = sanitizeRecord(raw, this.env.newId());
            if (record && !seen.has(record.id)) {
              seen.add(record.id);
              this.records.push(record);
            } else dropped++;
          }
          this.records.sort((a, b) => b.startedAt - a.startedAt);
          this.records = this.records.slice(0, this.maxRecords);
          if (dropped > 0) issues.push(`${dropped} unreadable history record(s) were skipped`);
        }
      }

      this.notify();
      return { loaded: this.records.length, dropped, issues };
    });
  }

  /** Newest first. */
  list(filter?: HistoryFilter): HistoryRecord[] {
    return filter ? this.records.filter((r) => matchesFilter(r, filter)) : [...this.records];
  }

  get(id: string): HistoryRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  summary(filter?: HistoryFilter): HistorySummary {
    return summarize(filter ? this.records.filter((r) => matchesFilter(r, filter)) : this.records);
  }

  /** Records an execution. Throws if the input is unusable or the write fails. */
  add(input: NewHistoryRecord): Promise<HistoryRecord> {
    const record = sanitizeRecord(input, this.env.newId());
    if (!record) return Promise.reject(new Error('Invalid history record'));

    return this.queue.run(async () => {
      const next = [record, ...this.records.filter((r) => r.id !== record.id)]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, this.maxRecords);
      await this.persist(next);
      return record;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.queue.run(async () => {
      if (!this.records.some((r) => r.id === id)) return false;
      await this.persist(this.records.filter((r) => r.id !== id));
      return true;
    });
  }

  clear(): Promise<void> {
    return this.queue.run(() => this.persist([]));
  }

  subscribe(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async persist(next: HistoryRecord[]): Promise<void> {
    await this.storage.set(this.key, JSON.stringify({ schemaVersion: HISTORY_SCHEMA_VERSION, records: next }));
    this.records = next;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.records);
      } catch {
        // A faulty listener must not break history.
      }
    }
  }
}
