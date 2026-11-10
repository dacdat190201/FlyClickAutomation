import { OcrError } from './errors';
import { analyze } from './matcher';
import type { OcrResult, OcrSearchConfig, ScanResult, TextRecognizer } from './types';

/**
 * Reusable OCR entry point: recognise an image, then search it for the configured keywords.
 * UI-independent; the recognizer is injected so tests and other platforms can swap it.
 */
export class OcrService {
  private readonly recognizer: TextRecognizer;

  constructor(recognizer: TextRecognizer) {
    this.recognizer = recognizer;
  }

  /** Recognised text and bounding boxes for an image. */
  async recognize(imageUri: string): Promise<OcrResult> {
    if (!imageUri) throw new OcrError('imageUri is required');
    return this.recognizer.recognize(imageUri);
  }

  /** Recognise `imageUri`, then find target and success keywords. */
  async scan(imageUri: string, config: OcrSearchConfig): Promise<ScanResult> {
    const ocr = await this.recognize(imageUri);
    return analyze(ocr, config);
  }
}
