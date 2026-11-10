import { normalize, type OcrResult } from '../ocr';

/**
 * Compact description of "what else is on screen": the set of normalised line texts, leaving
 * out lines that contain a keyword. Keyword lines are expected to change (a button turns into
 * "Đã đăng ký"), so they must not count as an unexpected change.
 */
export function fingerprint(
  ocr: OcrResult,
  excludeKeywords: string[] = [],
  ignoreDiacritics = true,
): Set<string> {
  const excluded = excludeKeywords
    .map((k) => normalize(k, ignoreDiacritics).text)
    .filter((k) => k.length > 0);

  const lines = new Set<string>();
  for (const line of ocr.lines) {
    const text = normalize(line.text, ignoreDiacritics).text;
    if (!text || excluded.some((k) => text.includes(k))) continue;
    lines.add(text);
  }
  return lines;
}

/** Jaccard similarity of two fingerprints (1 = identical, 0 = nothing in common). */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const line of a) if (b.has(line)) shared++;
  return shared / (a.size + b.size - shared);
}
