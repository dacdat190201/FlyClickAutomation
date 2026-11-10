export { OCR_SENSITIVITY_HELP, OCR_SENSITIVITY_LABEL, toClickEngineConfig, toMatchOptions } from './derive';
export { SETTINGS_STORAGE_KEY, SettingsStore, type SettingsListener } from './store';
export {
  DEFAULT_SETTINGS,
  OCR_SENSITIVITIES,
  SETTINGS_LIMITS,
  SETTINGS_SCHEMA_VERSION,
  SettingsError,
  THEMES,
  type OcrSensitivity,
  type Settings,
  type ThemePreference,
} from './types';
export { checkSetting, parseSettings, validatePatch } from './validation';
