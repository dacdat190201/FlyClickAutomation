import {
  DEFAULT_SETTINGS,
  OCR_SENSITIVITIES,
  SETTINGS_LIMITS,
  SettingsError,
  THEMES,
  type Settings,
} from './types';

/** Returns an error message for an invalid value of `key`, or null when it is fine. */
export function checkSetting<K extends keyof Settings>(key: K, value: unknown): string | null {
  switch (key) {
    case 'clickIntervalMs':
    case 'retryCount': {
      const { min, max } = SETTINGS_LIMITS[key as 'clickIntervalMs' | 'retryCount'];
      const label = key === 'clickIntervalMs' ? 'Click interval' : 'Retry count';
      const unit = key === 'clickIntervalMs' ? ' ms' : '';
      return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
        ? null
        : `${label} must be a whole number from ${min} to ${max}${unit}`;
    }
    case 'ocrSensitivity':
      return OCR_SENSITIVITIES.includes(value as never) ? null : 'OCR sensitivity must be strict, balanced or lenient';
    case 'theme':
      return THEMES.includes(value as never) ? null : 'Theme must be system, light or dark';
    case 'hapticFeedback':
      return typeof value === 'boolean' ? null : 'Haptic feedback must be on or off';
    default:
      return `Unknown setting "${String(key)}"`;
  }
}

/** Validates a patch from the app. Throws `SettingsError` if any field is wrong. */
export function validatePatch(patch: Partial<Settings>): Partial<Settings> {
  const problems: string[] = [];
  const clean: Partial<Settings> = {};
  for (const key of Object.keys(patch) as (keyof Settings)[]) {
    if (!(key in DEFAULT_SETTINGS)) {
      problems.push(`Unknown setting "${key}"`);
      continue;
    }
    const message = checkSetting(key, patch[key]);
    if (message) problems.push(message);
    else (clean as Record<string, unknown>)[key] = patch[key];
  }
  if (problems.length > 0) throw new SettingsError(problems);
  return clean;
}

/**
 * Reads stored (untrusted) settings. Each invalid or missing field falls back to its default, so
 * a corrupt value can never break the app; problems are reported for logging.
 */
export function parseSettings(raw: unknown): { settings: Settings; issues: string[] } {
  const issues: string[] = [];
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) issues.push('Stored settings are not an object; using defaults');
    return { settings, issues };
  }

  const stored = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!(key in stored)) continue;
    const message = checkSetting(key, stored[key]);
    if (message) issues.push(`${message}; using the default`);
    else (settings as Record<string, unknown>)[key] = stored[key];
  }
  return { settings, issues };
}
