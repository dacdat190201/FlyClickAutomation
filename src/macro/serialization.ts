import {
  LIMITS,
  MACRO_FILE_FORMAT,
  MACRO_SCHEMA_VERSION,
  defaultMacroEnv,
  isoNow,
  type Issue,
  type Macro,
  type MacroEnv,
  type MacroFile,
} from './types';
import { parseMacro } from './validation';

export function toMacroFile(macros: readonly Macro[], env: MacroEnv = defaultMacroEnv): MacroFile {
  return {
    format: MACRO_FILE_FORMAT,
    schemaVersion: MACRO_SCHEMA_VERSION,
    exportedAt: isoNow(env),
    macros: macros.map((m) => JSON.parse(JSON.stringify(m)) as Macro),
  };
}

/** JSON text of a macro file, ready to be saved or shared. */
export function exportMacros(macros: readonly Macro[], env: MacroEnv = defaultMacroEnv): string {
  return JSON.stringify(toMacroFile(macros, env), null, 2);
}

export type ConflictPolicy = 'rename' | 'replace' | 'skip';

export type ImportItem = {
  macro: Macro;
  /** `replace` overwrites the existing macro with the same id. */
  action: 'add' | 'replace';
};

export type ImportResult = {
  items: ImportItem[];
  skipped: { name: string; reason: string }[];
  issues: Issue[];
  /** Set when the file as a whole could not be read; nothing was imported. */
  fatal: string | null;
};

export type ImportOptions = {
  existing?: readonly Macro[];
  /** What to do when an imported macro has the id of an existing one. Default `rename`. */
  onConflict?: ConflictPolicy;
  env?: MacroEnv;
};

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Reads macros from untrusted JSON. Accepts a macro file, a bare array, or a single macro.
 * Every macro is validated and rebuilt from known fields, so unknown or hostile properties
 * never reach the app. Nothing is executed or saved here.
 */
export function importMacros(json: string, options: ImportOptions = {}): ImportResult {
  const env = options.env ?? defaultMacroEnv;
  const policy = options.onConflict ?? 'rename';
  const result: ImportResult = { items: [], skipped: [], issues: [], fatal: null };
  const fatal = (message: string): ImportResult => ({ ...result, fatal: message });

  if (json.length > LIMITS.maxImportBytes) return fatal(`The file is larger than ${LIMITS.maxImportBytes} bytes`);

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return fatal(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  let rawMacros: unknown[];
  if (Array.isArray(data)) {
    rawMacros = data;
  } else if (isObject(data) && 'macros' in data) {
    if (data.format !== MACRO_FILE_FORMAT) return fatal(`Unknown file format ${JSON.stringify(data.format)}`);
    if (typeof data.schemaVersion !== 'number' || data.schemaVersion > MACRO_SCHEMA_VERSION) {
      return fatal(`Unsupported schemaVersion ${JSON.stringify(data.schemaVersion)} (this app understands ${MACRO_SCHEMA_VERSION})`);
    }
    if (!Array.isArray(data.macros)) return fatal('"macros" must be an array');
    rawMacros = data.macros;
  } else if (isObject(data)) {
    rawMacros = [data];
  } else {
    return fatal('Expected a macro file, a macro, or an array of macros');
  }

  const takenIds = new Set((options.existing ?? []).map((m) => m.id));
  const takenNames = new Set((options.existing ?? []).map((m) => m.name));

  for (const raw of rawMacros) {
    const label = isObject(raw) && typeof raw.name === 'string' && raw.name ? raw.name : '(unnamed)';
    const parsed = parseMacro(raw, env);
    for (const issue of parsed.issues) result.issues.push({ ...issue, message: `Macro "${label}": ${issue.message}` });

    if (!parsed.macro) {
      result.skipped.push({ name: label, reason: parsed.issues.filter((i) => i.level === 'error').map((i) => i.message).join('; ') });
      continue;
    }

    let macro = parsed.macro;
    let action: ImportItem['action'] = 'add';
    if (takenIds.has(macro.id)) {
      if (policy === 'skip') {
        result.skipped.push({ name: macro.name, reason: 'A macro with this id already exists' });
        continue;
      }
      if (policy === 'replace') action = 'replace';
      else {
        macro = { ...macro, id: env.newId('macro') };
        if (takenNames.has(macro.name)) macro = { ...macro, name: `${macro.name} (imported)` };
      }
    }
    takenIds.add(macro.id);
    takenNames.add(macro.name);
    result.items.push({ macro, action });
  }

  return result;
}
