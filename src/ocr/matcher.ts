import { centerOf, unionBoxes } from './geometry';
import { normalize } from './normalize';
import type {
  Box,
  MatchOptions,
  OcrLine,
  OcrResult,
  OcrSearchConfig,
  ScanResult,
  TextMatch,
} from './types';

export const DEFAULT_MATCH_OPTIONS: MatchOptions = { ignoreDiacritics: true, mode: 'contains' };

/** Trims, drops empty entries and removes duplicates (compared case-insensitively). */
export function cleanKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of keywords) {
    const keyword = raw.trim();
    const key = normalize(keyword, false).text;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(keyword);
  }
  return result;
}

/** Character range of each word inside `line.text`, or null if the words do not line up. */
function wordRanges(line: OcrLine): [number, number][] | null {
  const ranges: [number, number][] = [];
  let cursor = 0;
  for (const word of line.words) {
    const at = line.text.indexOf(word.text, cursor);
    if (at < 0) return null;
    ranges.push([at, at + word.text.length]);
    cursor = at + word.text.length;
  }
  return ranges;
}

/** Box covering the words that overlap [start, end); falls back to the whole line box. */
function boxForSpan(line: OcrLine, start: number, end: number): Box | null {
  const ranges = wordRanges(line);
  if (ranges) {
    const boxes: Box[] = [];
    line.words.forEach((word, i) => {
      const [ws, we] = ranges[i];
      if (word.box && ws < end && we > start) boxes.push(word.box);
    });
    const union = unionBoxes(boxes);
    if (union) return union;
  }
  return line.box ?? null;
}

function findInLine(
  line: OcrLine,
  lineIndex: number,
  keyword: string,
  options: MatchOptions,
): TextMatch[] {
  const needle = normalize(keyword, options.ignoreDiacritics).text;
  if (!needle) return [];
  const hay = normalize(line.text, options.ignoreDiacritics);

  const spans: [number, number][] = [];
  if (options.mode === 'exact') {
    if (hay.text === needle) spans.push([0, hay.text.length]);
  } else {
    let from = 0;
    for (;;) {
      const at = hay.text.indexOf(needle, from);
      if (at < 0) break;
      spans.push([at, at + needle.length]);
      from = at + needle.length;
    }
  }

  return spans.map(([ns, ne]) => {
    const start = hay.starts[ns];
    const end = hay.ends[ne - 1];
    const box = boxForSpan(line, start, end);
    return {
      keyword,
      matchedText: line.text.slice(start, end),
      lineText: line.text,
      lineIndex,
      start,
      end,
      box,
      center: box ? centerOf(box) : null,
    };
  });
}

/** Orders matches top-to-bottom, then left-to-right (falls back to recognition order). */
function sortReadingOrder(matches: TextMatch[]): TextMatch[] {
  if (!matches.every((m) => m.center)) {
    return [...matches].sort((a, b) => a.lineIndex - b.lineIndex || a.start - b.start);
  }
  return [...matches].sort((a, b) => a.center!.y - b.center!.y || a.center!.x - b.center!.x);
}

/** Finds every occurrence of every keyword in the OCR result. */
export function findMatches(
  ocr: OcrResult,
  keywords: string[],
  options: Partial<MatchOptions> = {},
): TextMatch[] {
  const opts = { ...DEFAULT_MATCH_OPTIONS, ...options };
  const matches: TextMatch[] = [];
  for (const keyword of cleanKeywords(keywords)) {
    ocr.lines.forEach((line, i) => matches.push(...findInLine(line, i, keyword, opts)));
  }
  return sortReadingOrder(matches);
}

/**
 * Applies the target/success configuration to an OCR result.
 *
 * A success phrase often contains the target phrase ("Đã đăng ký" contains "đăng ký"), so any
 * target match that overlaps a success match is discarded: that text is the result of the
 * action, not a button to press.
 */
export function analyze(ocr: OcrResult, config: OcrSearchConfig): ScanResult {
  const options: Partial<MatchOptions> = {
    ignoreDiacritics: config.ignoreDiacritics,
    mode: config.mode,
  };
  const successes = findMatches(ocr, config.successKeywords, options);
  const targets = findMatches(ocr, config.targetKeywords, options).filter(
    (t) =>
      !successes.some((s) => s.lineIndex === t.lineIndex && t.start < s.end && t.end > s.start),
  );

  return {
    ocr,
    targets,
    successes,
    status: successes.length > 0 ? 'success' : targets.length > 0 ? 'target-found' : 'not-found',
  };
}
