import type { ClickEngineConfig } from '../click';
import type { MatchOptions } from '../ocr';
import type { OcrSensitivity, Settings } from './types';

/**
 * Cách khớp chữ OCR ở từng mức:
 * - strict: cả dòng phải trùng từ khóa, phải đúng dấu.
 * - balanced: từ khóa có thể nằm trong một dòng, phải đúng dấu.
 * - lenient: từ khóa có thể nằm trong một dòng và bỏ qua dấu (OCR hay đọc mất dấu).
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
  strict: 'Cả dòng phải trùng từ khóa và phải đúng dấu.',
  balanced: 'Từ khóa có thể nằm trong một dòng, nhưng phải đúng dấu.',
  lenient: 'Từ khóa có thể nằm trong một dòng và bỏ qua dấu. Phù hợp khi OCR đọc mất dấu.',
};

export const OCR_SENSITIVITY_LABEL: Record<OcrSensitivity, string> = {
  strict: 'Chặt',
  balanced: 'Cân bằng',
  lenient: 'Thoáng',
};

/** Click Engine defaults from the saved settings. */
export function toClickEngineConfig(settings: Settings): Partial<ClickEngineConfig> {
  return { minIntervalMs: settings.clickIntervalMs };
}
