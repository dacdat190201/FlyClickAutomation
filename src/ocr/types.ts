/**
 * Public types of the OCR module.
 * Core files in src/ocr (everything except mlkit-recognizer.ts) are pure TypeScript:
 * no React, Expo or native imports, so they can be unit tested anywhere.
 *
 * Coordinates are in the pixel space of the analysed image (origin top-left), NOT screen points.
 */

export type Box = { left: number; top: number; width: number; height: number };
export type Point = { x: number; y: number };

export type OcrWord = { text: string; box?: Box };

export type OcrLine = {
  text: string;
  box?: Box;
  /** Words (ML Kit "elements") in reading order. Used to compute precise match boxes. */
  words: OcrWord[];
};

export type OcrResult = {
  text: string;
  lines: OcrLine[];
};

/** Source of OCR results. The real one wraps ML Kit; tests use fakes. */
export interface TextRecognizer {
  /** `imageUri` must point to an image the app is allowed to read (e.g. picked by the user). */
  recognize(imageUri: string): Promise<OcrResult>;
}

export type MatchMode = 'contains' | 'exact';

export type MatchOptions = {
  /**
   * Treat "đăng ký" and "dang ky" as equal. On by default because OCR often drops or
   * misreads Vietnamese diacritics.
   */
  ignoreDiacritics: boolean;
  /** `contains` = partial match inside a line. `exact` = the whole line must equal the keyword. */
  mode: MatchMode;
};

export type OcrSearchConfig = Partial<MatchOptions> & {
  /** Text of the button(s) to find, e.g. "Đăng ký". */
  targetKeywords: string[];
  /** Text that means the action worked, e.g. "Đã đăng ký". */
  successKeywords: string[];
};

export type TextMatch = {
  /** The keyword (as configured) that produced this match. */
  keyword: string;
  /** The text as recognised in the image (original casing and diacritics). */
  matchedText: string;
  lineText: string;
  lineIndex: number;
  /** [start, end) character range of the match inside `lineText`. */
  start: number;
  end: number;
  /** Bounding box of the matched words, or of the line when word boxes are unavailable. */
  box: Box | null;
  /** Centre of `box`: a natural tap point. */
  center: Point | null;
};

export type ScanStatus = 'success' | 'target-found' | 'not-found';

export type ScanResult = {
  ocr: OcrResult;
  /** Every place a target keyword was found (multiple buttons are all returned). */
  targets: TextMatch[];
  successes: TextMatch[];
  /** `success` wins over `target-found`. */
  status: ScanStatus;
};
