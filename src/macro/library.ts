import { cloneMacro } from './editing';
import { exportMacros, importMacros, toMacroFile, type ConflictPolicy, type ImportResult } from './serialization';
import {
  MACRO_SCHEMA_VERSION,
  defaultMacroEnv,
  isoNow,
  type Issue,
  type Macro,
  type MacroCoordinateSpace,
  type MacroEnv,
  type MacroPlatform,
  type MacroRepeat,
  type MacroStep,
} from './types';
import { parseMacro } from './validation';

/** Where the library keeps its single JSON document. */
export interface MacroStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export class InMemoryMacroStorage implements MacroStorage {
  value: string | null = null;
  async read() {
    return this.value;
  }
  async write(value: string) {
    this.value = value;
  }
}

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

/** Persists macros with @react-native-async-storage/async-storage (works in Expo Go). */
export class AsyncStorageMacroStorage implements MacroStorage {
  private readonly key: string;
  private readonly load: () => AsyncStorageLike;

  constructor(
    key = 'flyclick.macros.v1',
    // Loaded lazily so importing this file never touches native code (tests, web).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    load: () => AsyncStorageLike = () => require('@react-native-async-storage/async-storage').default,
  ) {
    this.key = key;
    this.load = load;
  }

  read() {
    return this.load().getItem(this.key);
  }

  write(value: string) {
    return this.load().setItem(this.key, value);
  }
}

export class MacroLibraryError extends Error {
  readonly issues: Issue[];
  constructor(message: string, issues: Issue[] = []) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'MacroLibraryError';
    this.issues = issues;
  }
}

export type CreateMacroInit = Partial<{
  platform: MacroPlatform;
  coordinateSpace: MacroCoordinateSpace;
  repeat: MacroRepeat;
  steps: MacroStep[];
}>;

export type LoadResult = {
  loaded: number;
  /** Stored entries that could not be read. They are kept (not deleted) in the stored file. */
  quarantined: number;
  issues: Issue[];
};

/**
 * A collection of macros, persisted as one JSON document. Operations run one at a time, so
 * overlapping saves cannot overwrite each other. State only changes after the write succeeds.
 */
export class MacroLibrary {
  private readonly storage: MacroStorage;
  private readonly env: MacroEnv;
  private macros: Macro[] = [];
  private quarantined: unknown[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(storage: MacroStorage, env: MacroEnv = defaultMacroEnv) {
    this.storage = storage;
    this.env = env;
  }

  /** Reads the stored macros. Call once at startup. Corrupt entries are reported and preserved. */
  load(): Promise<LoadResult> {
    return this.exclusive(async () => {
      const stored = await this.storage.read();
      this.macros = [];
      this.quarantined = [];
      if (stored === null) return { loaded: 0, quarantined: 0, issues: [] };

      let data: unknown;
      try {
        data = JSON.parse(stored);
      } catch (e) {
        throw new MacroLibraryError(`Stored macros are not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
      const file = (typeof data === 'object' && data !== null ? data : {}) as { macros?: unknown; quarantined?: unknown };
      const rawMacros = Array.isArray(file.macros) ? file.macros : [];
      const issues: Issue[] = [];
      const seen = new Set<string>();

      for (const raw of rawMacros) {
        const parsed = parseMacro(raw, this.env);
        if (parsed.macro && !seen.has(parsed.macro.id)) {
          seen.add(parsed.macro.id);
          this.macros.push(parsed.macro);
        } else {
          this.quarantined.push(raw);
          issues.push(...(parsed.issues.length ? parsed.issues : [{ level: 'error' as const, code: 'DUPLICATE_ID', message: 'Duplicate macro id' }]));
        }
      }
      if (Array.isArray(file.quarantined)) this.quarantined.push(...file.quarantined);
      return { loaded: this.macros.length, quarantined: this.quarantined.length, issues };
    });
  }

  list(): readonly Macro[] {
    return this.macros;
  }

  get(id: string): Macro | undefined {
    return this.macros.find((m) => m.id === id);
  }

  create(name: string, init: CreateMacroInit = {}): Promise<Macro> {
    return this.exclusive(async () => {
      const now = isoNow(this.env);
      const draft = {
        schemaVersion: MACRO_SCHEMA_VERSION,
        id: this.env.newId('macro'),
        name,
        createdAt: now,
        updatedAt: now,
        platform: init.platform ?? 'any',
        coordinateSpace: init.coordinateSpace ?? 'screen-pixels',
        repeat: init.repeat ?? { count: 1, delayBetweenMs: 0 },
        steps: init.steps ?? [],
      };
      const macro = this.validated(draft);
      await this.persist([...this.macros, macro]);
      return macro;
    });
  }

  /** Adds a macro, or replaces the one with the same id. */
  save(macro: Macro): Promise<Macro> {
    return this.exclusive(async () => {
      const valid = this.validated(macro);
      const exists = this.macros.some((m) => m.id === valid.id);
      await this.persist(exists ? this.macros.map((m) => (m.id === valid.id ? valid : m)) : [...this.macros, valid]);
      return valid;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.exclusive(async () => {
      if (!this.macros.some((m) => m.id === id)) return false;
      await this.persist(this.macros.filter((m) => m.id !== id));
      return true;
    });
  }

  duplicate(id: string, name?: string): Promise<Macro> {
    return this.exclusive(async () => {
      const source = this.macros.find((m) => m.id === id);
      if (!source) throw new MacroLibraryError(`No macro with id "${id}"`);
      const copy = cloneMacro(source, name ?? `${source.name} (copy)`, this.env);
      await this.persist([...this.macros, copy]);
      return copy;
    });
  }

  /** Imports macros from JSON text and saves them. Returns what was imported and what was skipped. */
  importJson(json: string, onConflict: ConflictPolicy = 'rename'): Promise<ImportResult> {
    return this.exclusive(async () => {
      const result = importMacros(json, { existing: this.macros, onConflict, env: this.env });
      if (result.fatal || result.items.length === 0) return result;

      let next = [...this.macros];
      for (const { macro, action } of result.items) {
        next = action === 'replace' ? next.map((m) => (m.id === macro.id ? macro : m)) : [...next, macro];
      }
      await this.persist(next);
      return result;
    });
  }

  /** JSON text for the given macros (all when `ids` is omitted). */
  exportJson(ids?: readonly string[]): string {
    return exportMacros(ids ? this.macros.filter((m) => ids.includes(m.id)) : this.macros, this.env);
  }

  // ---- internals ---------------------------------------------------------------------------

  private validated(candidate: unknown): Macro {
    const { macro, issues } = parseMacro(candidate, this.env);
    if (!macro) {
      throw new MacroLibraryError(issues.filter((i) => i.level === 'error').map((i) => i.message).join('; '), issues);
    }
    return macro;
  }

  private async persist(next: Macro[]): Promise<void> {
    const file = { ...toMacroFile(next, this.env), quarantined: this.quarantined };
    await this.storage.write(JSON.stringify(file));
    this.macros = next; // only after a successful write
  }

  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = this.chain.then(job, job);
    this.chain = run.catch(() => undefined);
    return run;
  }
}
