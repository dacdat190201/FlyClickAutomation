export { OcrError, OcrUnavailableError } from './errors';
export { centerOf, unionBoxes } from './geometry';
export { analyze, cleanKeywords, DEFAULT_MATCH_OPTIONS, findMatches } from './matcher';
export { MlKitTextRecognizer, mapMlKitResult, type RawMlKitResult } from './mlkit-recognizer';
export { normalize, type Normalized } from './normalize';
export { OcrService } from './ocr-service';
export type {
  Box,
  MatchMode,
  MatchOptions,
  OcrLine,
  OcrResult,
  OcrSearchConfig,
  OcrWord,
  Point,
  ScanResult,
  ScanStatus,
  TextMatch,
  TextRecognizer,
} from './types';
