export const SETTINGS_SCHEMA_VERSION = 1;

export type OcrSensitivity = 'strict' | 'balanced' | 'lenient';
export type ThemePreference = 'system' | 'light' | 'dark';

export type Settings = {
  /** Default minimum gap between clicks, in ms. */
  clickIntervalMs: number;
  /** How forgiving OCR text matching is (see `toMatchOptions`). */
  ocrSensitivity: OcrSensitivity;
  /** Default number of retries after a failed click or target. */
  retryCount: number;
  hapticFeedback: boolean;
  theme: ThemePreference;
};

export const DEFAULT_SETTINGS: Settings = {
  clickIntervalMs: 300,
  ocrSensitivity: 'lenient',
  retryCount: 2,
  hapticFeedback: true,
  theme: 'light',
};

export const SETTINGS_LIMITS = {
  clickIntervalMs: { min: 50, max: 60_000 },
  retryCount: { min: 0, max: 10 },
} as const;

export const OCR_SENSITIVITIES: readonly OcrSensitivity[] = ['strict', 'balanced', 'lenient'];
export const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export class SettingsError extends Error {
  /** Human-readable problems, one per invalid field. */
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join('; '));
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'SettingsError';
    this.problems = problems;
  }
}
