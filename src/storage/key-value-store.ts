/** Minimal async key-value storage used by the settings and history modules. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class InMemoryKeyValueStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.data.set(key, value);
  }
  async remove(key: string) {
    this.data.delete(key);
  }
}

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** Persistent local storage backed by @react-native-async-storage/async-storage (works in Expo Go). */
export class AsyncStorageKeyValueStore implements KeyValueStore {
  private readonly load: () => AsyncStorageLike;

  constructor(
    // Loaded lazily so that importing this file never touches native code (tests, web).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    load: () => AsyncStorageLike = () => require('@react-native-async-storage/async-storage').default,
  ) {
    this.load = load;
  }

  get(key: string) {
    return this.load().getItem(key);
  }
  set(key: string, value: string) {
    return this.load().setItem(key, value);
  }
  remove(key: string) {
    return this.load().removeItem(key);
  }
}

/** Runs jobs one after another, so overlapping read-modify-write cycles cannot interleave. */
export class SerialQueue {
  private chain: Promise<unknown> = Promise.resolve();

  run<T>(job: () => Promise<T>): Promise<T> {
    const result = this.chain.then(job, job);
    this.chain = result.catch(() => undefined);
    return result;
  }
}
