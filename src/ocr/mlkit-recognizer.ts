import { OcrError, OcrUnavailableError } from './errors';
import type { Box, OcrLine, OcrResult, OcrWord, TextRecognizer } from './types';

/**
 * Shapes returned by @react-native-ml-kit/text-recognition (declared here so the rest of the
 * module never imports the native package).
 */
type RawFrame = { left: number; top: number; width: number; height: number };
type RawElement = { text: string; frame?: RawFrame };
type RawLine = { text: string; frame?: RawFrame; elements?: RawElement[] };
type RawBlock = { text: string; lines?: RawLine[] };
export type RawMlKitResult = { text: string; blocks?: RawBlock[] };

type MlKitModule = {
  default: { recognize(uri: string, script?: string): Promise<RawMlKitResult> };
};

/**
 * ML Kit has no separate Vietnamese model: Vietnamese is covered by the Latin script model.
 * Recognition of diacritics is best-effort, hence the diacritic-insensitive matching option.
 */
const SCRIPT = 'Latin';

function toBox(frame?: RawFrame): Box | undefined {
  return frame
    ? { left: frame.left, top: frame.top, width: frame.width, height: frame.height }
    : undefined;
}

/** Converts the native result (blocks > lines > elements) into the module's flat line list. */
export function mapMlKitResult(raw: RawMlKitResult): OcrResult {
  const lines: OcrLine[] = [];
  for (const block of raw.blocks ?? []) {
    for (const line of block.lines ?? []) {
      const words: OcrWord[] = (line.elements ?? []).map((e) => ({
        text: e.text,
        box: toBox(e.frame),
      }));
      lines.push({ text: line.text, box: toBox(line.frame), words });
    }
  }
  return { text: raw.text ?? '', lines };
}

function defaultLoader(): MlKitModule {
  // Loaded lazily so that importing this file never touches native code (tests, Expo Go).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-ml-kit/text-recognition') as MlKitModule;
}

/**
 * On-device OCR using Google ML Kit. Requires a development build: the native module is not
 * part of Expo Go, where `recognize` rejects with `OcrUnavailableError`.
 *
 * Only reads the image at `imageUri`. It never captures the screen or other apps; callers must
 * pass images the user has chosen or the app already owns.
 */
export class MlKitTextRecognizer implements TextRecognizer {
  private readonly load: () => MlKitModule;

  constructor(loader: () => MlKitModule = defaultLoader) {
    this.load = loader;
  }

  async recognize(imageUri: string): Promise<OcrResult> {
    if (!imageUri) throw new OcrError('imageUri is required');

    let raw: RawMlKitResult;
    try {
      raw = await this.load().default.recognize(imageUri, SCRIPT);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/doesn't seem to be linked|Cannot find module/i.test(message)) {
        throw new OcrUnavailableError(
          'ML Kit text recognition is not available in this build. Use a development build (not Expo Go).',
          { cause: e },
        );
      }
      throw new OcrError(`Text recognition failed: ${message}`, { cause: e });
    }
    return mapMlKitResult(raw);
  }
}
