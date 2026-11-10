import type { ClickEngineConfig } from '../click';
import type { MatchOptions } from '../ocr';
import type { OcrSensitivity, Settings } from './types';

/**
 * How OCR text is matched at each sensitivity:
 * - strict: the whole line must equal the keyword, accents must match.
 * - balanced: the keyword may be part of a line, accents must match.
 * - lenient: the keyword may be part of a line and accents are ignored (OCR often drops them).
 */
export function toMatchOptions(sensitivity: OcrSensitivity): MatchOptions {
  switch (sensitivity) {
    case 'strict':
      return { mode: 'exact', ignoreDiacritics: false };
    case 'balanced':
      return { mode: 'contains', ignoreDiacritics: false };
    case 'lenient':
      return { mode: 'contains', ignoreDiacritics: true };
  }
}

export const OCR_SENSITIVITY_HELP: Record<OcrSensitivity, string> = {
  strict: 'The whole line must equal the keyword, accents must match.',
  balanced: 'The keyword may be part of a line, accents must match.',
  lenient: 'The keyword may be part of a line and accents are ignored. Best when OCR drops accents.',
};

/** Click Engine defaults from the saved settings. */
export function toClickEngineConfig(settings: Settings): Partial<ClickEngineConfig> {
  return { minIntervalMs: settings.clickIntervalMs };
}
