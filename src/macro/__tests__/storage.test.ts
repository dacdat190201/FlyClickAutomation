import {
  AsyncStorageMacroStorage,
  InMemoryMacroStorage,
  MacroLibrary,
  MacroLibraryError,
  exportMacros,
  importMacros,
  type MacroStorage,
} from '..';
import { macroOf, tap, testEnv, wait } from '../__fixtures__/helpers';

describe('import / export', () => {
  const env = testEnv();
  const a = macroOf([tap('a', 10, 10, 0), wait('w', 500)], { id: 'm_a', name: 'Alpha' });
  const b = macroOf([tap('b', 30, 30)], { id: 'm_b', name: 'Beta', repeat: { count: 4, delayBetweenMs: 100 } });

  it('round-trips macros through JSON unchanged', () => {
    const json = exportMacros([a, b], env);
    const result = importMacros(json, { env });

    expect(result.fatal).toBeNull();
    expect(result.items.map((i) => i.macro)).toEqual([a, b]);
    expect(result.skipped).toEqual([]);
  });

  it('exports a documented, versioned file', () => {
    const file = JSON.parse(exportMacros([a], env));
    expect(file).toMatchObject({ format: 'flyclick-macros', schemaVersion: 1, macros: [{ id: 'm_a', steps: expect.any(Array) }] });
    expect(typeof file.exportedAt).toBe('string');
  });

  it('accepts a single macro or a bare array too', () => {
    expect(importMacros(JSON.stringify(a), { env }).items).toHaveLength(1);
    expect(importMacros(JSON.stringify([a, b]), { env }).items).toHaveLength(2);
  });

  it.each([
    ['broken JSON', '{nope'],
    ['a number', '42'],
    ['null', 'null'],
    ['a string', '"hi"'],
    ['a foreign file', JSON.stringify({ format: 'something-else', schemaVersion: 1, macros: [] })],
    ['a newer file', JSON.stringify({ format: 'flyclick-macros', schemaVersion: 99, macros: [] })],
    ['macros not an array', JSON.stringify({ format: 'flyclick-macros', schemaVersion: 1, macros: {} })],
  ])('refuses %s as a whole, importing nothing', (_label, json) => {
    const result = importMacros(json, { env });
    expect(result.fatal).toEqual(expect.any(String));
    expect(result.items).toEqual([]);
  });

  it('refuses oversized files', () => {
    expect(importMacros(' '.repeat(5_000_001), { env }).fatal).toMatch(/larger/);
  });

  it('skips invalid macros but keeps the good ones, and says why', () => {
    const file = { format: 'flyclick-macros', schemaVersion: 1, macros: [a, { name: 'Broken', platform: 'android', coordinateSpace: 'screen-pixels', steps: [{ type: 'tap', x: -1, y: 0 }] }, b] };
    const result = importMacros(JSON.stringify(file), { env });

    expect(result.items.map((i) => i.macro.id)).toEqual(['m_a', 'm_b']);
    expect(result.skipped).toEqual([{ name: 'Broken', reason: expect.stringContaining('Step 1') }]);
    expect(result.issues.some((i) => i.message.startsWith('Macro "Broken"'))).toBe(true);
  });

  describe('id conflicts', () => {
    const json = exportMacros([a], env);

    it('renames by default (new id, name marked when it collides)', () => {
      const [item] = importMacros(json, { existing: [a], env }).items;
      expect(item.action).toBe('add');
      expect(item.macro.id).not.toBe('m_a');
      expect(item.macro.name).toBe('Alpha (imported)');
    });

    it('can replace the existing macro', () => {
      const [item] = importMacros(json, { existing: [a], onConflict: 'replace', env }).items;
      expect(item).toMatchObject({ action: 'replace', macro: { id: 'm_a' } });
    });

    it('can skip', () => {
      const result = importMacros(json, { existing: [a], onConflict: 'skip', env });
      expect(result.items).toEqual([]);
      expect(result.skipped).toHaveLength(1);
    });

    it('also resolves duplicates inside the same file', () => {
      const twice = exportMacros([a, a], env);
      const ids = importMacros(twice, { env }).items.map((i) => i.macro.id);
      expect(new Set(ids).size).toBe(2);
    });
  });

  it('does not let hostile properties through', () => {
    const json = '{"format":"flyclick-macros","schemaVersion":1,"macros":[{"name":"x","platform":"any","coordinateSpace":"screen-pixels","steps":[],"__proto__":{"admin":true},"constructor":{"prototype":{"admin":true}}}]}';
    const [item] = importMacros(json, { env }).items;
    expect(item.macro).not.toHaveProperty('constructor.prototype.admin');
    expect(({} as { admin?: boolean }).admin).toBeUndefined();
  });
});

describe('MacroLibrary', () => {
  const env = testEnv();
  const open = async (storage: MacroStorage = new InMemoryMacroStorage()) => {
    const library = new MacroLibrary(storage, env);
    await library.load();
    return { library, storage };
  };

  it('creates, lists, gets and removes macros', async () => {
    const { library } = await open();
    const one = await library.create('One', { platform: 'android', steps: [tap('s', 1, 1)] });
    const two = await library.create('Two');

    expect(library.list().map((m) => m.name)).toEqual(['One', 'Two']);
    expect(library.get(one.id)).toEqual(one);
    expect(await library.remove(two.id)).toBe(true);
    expect(await library.remove(two.id)).toBe(false);
    expect(library.list()).toHaveLength(1);
  });

  it('keeps multiple macros across sessions', async () => {
    const storage = new InMemoryMacroStorage();
    const first = await open(storage);
    await first.library.create('Saved A', { steps: [tap('s', 1, 1)] });
    await first.library.create('Saved B');

    const second = await open(storage);
    expect(second.library.list().map((m) => m.name)).toEqual(['Saved A', 'Saved B']);
    expect(second.library.list()[0].steps).toHaveLength(1);
  });

  it('saves edits (add or replace by id) and validates what it stores', async () => {
    const { library } = await open();
    const created = await library.create('Edit me', { steps: [tap('s', 1, 1)] });
    await library.save({ ...created, name: 'Edited' });
    expect(library.list()).toHaveLength(1);
    expect(library.get(created.id)!.name).toBe('Edited');

    await expect(library.save({ ...created, name: '' })).rejects.toBeInstanceOf(MacroLibraryError);
    await expect(library.create('   ')).rejects.toBeInstanceOf(MacroLibraryError);
    expect(library.get(created.id)!.name).toBe('Edited');
  });

  it('duplicates a macro with fresh ids', async () => {
    const { library } = await open();
    const original = await library.create('Orig', { steps: [tap('s', 1, 1)] });
    const copy = await library.duplicate(original.id);

    expect(copy.name).toBe('Orig (copy)');
    expect(copy.id).not.toBe(original.id);
    expect(copy.steps[0].id).not.toBe(original.steps[0].id);
    await expect(library.duplicate('missing')).rejects.toBeInstanceOf(MacroLibraryError);
  });

  it('imports and exports through the library', async () => {
    const { library } = await open();
    const source = macroOf([tap('a', 5, 5)], { id: 'ext', name: 'External' });
    const result = await library.importJson(exportMacros([source], env));

    expect(result.items).toHaveLength(1);
    expect(library.get('ext')).toBeDefined();

    const again = await library.importJson(exportMacros([source], env), 'rename');
    expect(again.items[0].macro.id).not.toBe('ext');
    expect(library.list()).toHaveLength(2);

    expect(JSON.parse(library.exportJson(['ext'])).macros).toHaveLength(1);
    expect(JSON.parse(library.exportJson()).macros).toHaveLength(2);
  });

  it('imports nothing (and writes nothing) from a bad file', async () => {
    const storage = new InMemoryMacroStorage();
    const { library } = await open(storage);
    const result = await library.importJson('not json');
    expect(result.fatal).not.toBeNull();
    expect(storage.value).toBeNull();
  });

  it('keeps corrupt stored entries instead of deleting them', async () => {
    const storage = new InMemoryMacroStorage();
    const good = macroOf([tap('a', 1, 1)], { id: 'good', name: 'Good' });
    storage.value = JSON.stringify({ format: 'flyclick-macros', schemaVersion: 1, macros: [good, { name: 'Bad', steps: 'oops' }] });

    const { library } = await open(storage);
    const loaded = await library.load();
    expect(loaded).toMatchObject({ loaded: 1, quarantined: 1 });
    expect(loaded.issues.length).toBeGreaterThan(0);

    await library.create('New one'); // triggers a write
    const written = JSON.parse(storage.value!);
    expect(written.quarantined).toEqual([{ name: 'Bad', steps: 'oops' }]);
    expect(written.macros).toHaveLength(2);
  });

  it('rejects unreadable storage instead of silently starting empty', async () => {
    const storage = new InMemoryMacroStorage();
    storage.value = '{broken';
    await expect(new MacroLibrary(storage, env).load()).rejects.toBeInstanceOf(MacroLibraryError);
  });

  it('serialises overlapping writes so none is lost', async () => {
    const { library } = await open();
    await Promise.all(Array.from({ length: 10 }, (_, i) => library.create(`Macro ${i}`)));
    expect(library.list()).toHaveLength(10);
  });

  it('does not change its state when the write fails', async () => {
    let failing = false;
    const storage: MacroStorage = {
      read: async () => null,
      write: async () => {
        if (failing) throw new Error('disk full');
      },
    };
    const { library } = await open(storage);
    await library.create('Kept');

    failing = true;
    await expect(library.create('Lost')).rejects.toThrow('disk full');
    expect(library.list().map((m) => m.name)).toEqual(['Kept']);

    failing = false;
    await library.create('After');
    expect(library.list().map((m) => m.name)).toEqual(['Kept', 'After']);
  });
});

describe('AsyncStorageMacroStorage', () => {
  it('reads and writes under its key', async () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => void store.set(k, v),
    };
    const storage = new AsyncStorageMacroStorage('test.key', () => fake);

    expect(await storage.read()).toBeNull();
    await storage.write('{"x":1}');
    expect(store.get('test.key')).toBe('{"x":1}');
    expect(await storage.read()).toBe('{"x":1}');
  });

  it('backs a library end to end', async () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => void store.set(k, v),
    };
    const lib1 = new MacroLibrary(new AsyncStorageMacroStorage('k', () => fake), testEnv());
    await lib1.load();
    await lib1.create('Persisted');

    const lib2 = new MacroLibrary(new AsyncStorageMacroStorage('k', () => fake), testEnv());
    await lib2.load();
    expect(lib2.list().map((m) => m.name)).toEqual(['Persisted']);
  });
});
