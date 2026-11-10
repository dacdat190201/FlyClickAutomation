import {
  mapMlKitResult,
  MlKitTextRecognizer,
  OcrError,
  OcrService,
  OcrUnavailableError,
  type RawMlKitResult,
  type TextRecognizer,
} from '..';
import { REGISTER_SCREEN, SUCCESS_SCREEN } from '../__fixtures__/screens';

const config = { targetKeywords: ['Đăng ký'], successKeywords: ['Đã đăng ký'] };

/** Fake recognizer that returns a canned result per image URI. */
function fakeRecognizer(images: Record<string, typeof REGISTER_SCREEN>): TextRecognizer & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    recognize: async (uri) => {
      calls.push(uri);
      const result = images[uri];
      if (!result) throw new Error(`no such image: ${uri}`);
      return result;
    },
  };
}

describe('OcrService', () => {
  const recognizer = fakeRecognizer({
    'file:///register.png': REGISTER_SCREEN,
    'file:///success.png': SUCCESS_SCREEN,
  });
  const service = new OcrService(recognizer);

  it('recognises an image and returns text with bounding boxes', async () => {
    const ocr = await service.recognize('file:///register.png');
    expect(ocr.text).toContain('Đăng ký ngay');
    expect(ocr.lines[1].box).toEqual({ left: 200, top: 600, width: 120, height: 30 });
  });

  it('scans a sign-up screenshot for the target', async () => {
    const result = await service.scan('file:///register.png', config);
    expect(result.status).toBe('target-found');
    expect(result.targets.map((t) => t.center)).toEqual([
      { x: 235, y: 615 },
      { x: 255, y: 915 },
    ]);
  });

  it('detects success on the confirmation screenshot', async () => {
    const result = await service.scan('file:///success.png', config);
    expect(result.status).toBe('success');
  });

  it('rejects an empty image URI without calling the recognizer', async () => {
    const before = recognizer.calls.length;
    await expect(service.scan('', config)).rejects.toBeInstanceOf(OcrError);
    expect(recognizer.calls).toHaveLength(before);
  });

  it('propagates recogniser failures', async () => {
    await expect(service.scan('file:///missing.png', config)).rejects.toThrow('no such image');
  });
});

describe('mapMlKitResult', () => {
  const raw: RawMlKitResult = {
    text: 'Đăng ký\nĐăng nhập',
    blocks: [
      {
        text: 'Đăng ký',
        lines: [
          {
            text: 'Đăng ký',
            frame: { left: 10, top: 20, width: 80, height: 24 },
            elements: [
              { text: 'Đăng', frame: { left: 10, top: 20, width: 40, height: 24 } },
              { text: 'ký', frame: { left: 60, top: 20, width: 30, height: 24 } },
            ],
          },
        ],
      },
      { text: 'Đăng nhập', lines: [{ text: 'Đăng nhập' }] }, // no frames, no elements
    ],
  };

  it('flattens blocks into lines with word boxes', () => {
    const ocr = mapMlKitResult(raw);
    expect(ocr.text).toBe('Đăng ký\nĐăng nhập');
    expect(ocr.lines).toHaveLength(2);
    expect(ocr.lines[0].box).toEqual({ left: 10, top: 20, width: 80, height: 24 });
    expect(ocr.lines[0].words.map((w) => w.text)).toEqual(['Đăng', 'ký']);
  });

  it('tolerates missing frames, elements and blocks', () => {
    const ocr = mapMlKitResult(raw);
    expect(ocr.lines[1]).toEqual({ text: 'Đăng nhập', box: undefined, words: [] });
    expect(mapMlKitResult({ text: '' })).toEqual({ text: '', lines: [] });
  });

  it('produces results the matcher can use', async () => {
    const service = new OcrService(
      new MlKitTextRecognizer(() => ({ default: { recognize: async () => raw } })),
    );
    const result = await service.scan('file:///x.png', config);
    expect(result.targets[0].box).toEqual({ left: 10, top: 20, width: 80, height: 24 });
  });
});

describe('MlKitTextRecognizer', () => {
  it('requests the Latin script (covers Vietnamese)', async () => {
    const recognize = jest.fn(async () => ({ text: '', blocks: [] }));
    await new MlKitTextRecognizer(() => ({ default: { recognize } })).recognize('file:///x.png');
    expect(recognize).toHaveBeenCalledWith('file:///x.png', 'Latin');
  });

  it('reports a missing native module as OcrUnavailableError', async () => {
    const recognizer = new MlKitTextRecognizer(() => ({
      default: {
        recognize: () => {
          throw new Error("The package '@react-native-ml-kit/text-recognition' doesn't seem to be linked.");
        },
      },
    }));
    await expect(recognizer.recognize('file:///x.png')).rejects.toBeInstanceOf(OcrUnavailableError);
  });

  it('reports a module that cannot be loaded as OcrUnavailableError', async () => {
    const recognizer = new MlKitTextRecognizer(() => {
      throw new Error("Cannot find module '@react-native-ml-kit/text-recognition'");
    });
    await expect(recognizer.recognize('file:///x.png')).rejects.toBeInstanceOf(OcrUnavailableError);
  });

  it('wraps other native failures in OcrError', async () => {
    const recognizer = new MlKitTextRecognizer(() => ({
      default: { recognize: async () => Promise.reject(new Error('bad image')) },
    }));
    const error = await recognizer.recognize('file:///x.png').catch((e) => e);
    expect(error).toBeInstanceOf(OcrError);
    expect(error).not.toBeInstanceOf(OcrUnavailableError);
    expect(error.message).toContain('bad image');
  });

  it('rejects an empty URI', async () => {
    const recognize = jest.fn();
    const recognizer = new MlKitTextRecognizer(() => ({ default: { recognize } }));
    await expect(recognizer.recognize('')).rejects.toBeInstanceOf(OcrError);
    expect(recognize).not.toHaveBeenCalled();
  });
});
