import {
  ClickError,
  type AdapterContext,
  type ClickAdapter,
  type ClickAvailability,
  type TapRequest,
} from '../../click';
import type { OcrResult, TextRecognizer } from '../../ocr';
import { line, screen } from '../../ocr/__fixtures__/screens';
import type { ScreenSource } from '../types';

/*
 * A tiny simulated registration app used to test the workflow end to end. It renders OCR results
 * (like ML Kit would) from its state, and reacts to taps at coordinates.
 * It is a stand-in: it was not produced by a real device.
 */

export type RowBehavior =
  | 'normal' // button turns into "Đã đăng ký" immediately
  | 'dead' // tapping never changes anything
  | 'delayed' // the UI updates only after a number of screen captures
  | 'popup'; // tapping opens an unrelated dialog

export type SimRow = {
  title: string;
  behavior: RowBehavior;
  registered: boolean;
  /** For `delayed`: how many captures until the UI updates. */
  delay: number;
  pendingScans: number;
};

export function row(title: string, behavior: RowBehavior = 'normal', options: { registered?: boolean; delay?: number } = {}): SimRow {
  return { title, behavior, registered: options.registered ?? false, delay: options.delay ?? 2, pendingScans: 0 };
}

const ROW_TOP = (i: number) => 300 + i * 200;
const TAB_BAR_TOP = 2200;
const TAB_LEFT = (i: number) => 100 + i * 300;
const BUTTON_LEFT = 700;
const textWidth = (text: string) => text.length * 10;

export class SimApp {
  current: string;
  popup = false;
  captures = 0;
  taps: { x: number; y: number }[] = [];
  /** Taps that landed on a row's "Đăng ký" button, by row title. */
  registerTaps = new Map<string, number>();
  /** Taps that landed on a button that already said "Đã đăng ký". */
  repeatHits = 0;

  constructor(
    readonly tabs: Record<string, SimRow[]>,
    private readonly options: { tabsInert?: boolean } = {},
  ) {
    this.current = Object.keys(tabs)[0];
  }

  get tabNames(): string[] {
    return Object.keys(this.tabs);
  }

  /** Renders the screen as OCR output. Advances rows whose update is delayed. */
  snapshot(): OcrResult {
    this.captures++;
    for (const r of this.tabs[this.current]) {
      if (r.pendingScans > 0 && --r.pendingScans === 0) r.registered = true;
    }

    if (this.popup) {
      return screen(
        line('Thông báo hệ thống', 300, 800),
        line('Bạn có chắc chắn muốn tiếp tục không', 100, 900),
        line('Đồng ý', 300, 1000),
        line('Hủy', 500, 1000),
      );
    }

    const lines = [line('Danh sách khóa học', 40, 100)];
    this.tabs[this.current].forEach((r, i) => {
      lines.push(line(r.title, 40, ROW_TOP(i)));
      lines.push(line(r.registered ? 'Đã đăng ký' : 'Đăng ký', BUTTON_LEFT, ROW_TOP(i)));
    });
    this.tabNames.forEach((name, i) => lines.push(line(name, TAB_LEFT(i), TAB_BAR_TOP)));
    return screen(...lines);
  }

  tap(x: number, y: number): void {
    this.taps.push({ x, y });
    if (this.popup) return;

    // Tab bar
    if (y >= TAB_BAR_TOP - 10 && y <= TAB_BAR_TOP + 40) {
      this.tabNames.forEach((name, i) => {
        if (x >= TAB_LEFT(i) && x <= TAB_LEFT(i) + textWidth(name) && !this.options.tabsInert) {
          this.current = name;
        }
      });
      return;
    }

    // Row buttons
    this.tabs[this.current].forEach((r, i) => {
      const width = textWidth(r.registered ? 'Đã đăng ký' : 'Đăng ký');
      const hit = x >= BUTTON_LEFT && x <= BUTTON_LEFT + width && y >= ROW_TOP(i) && y <= ROW_TOP(i) + 30;
      if (!hit) return;
      if (r.registered) {
        this.repeatHits++;
        return;
      }
      this.registerTaps.set(r.title, (this.registerTaps.get(r.title) ?? 0) + 1);
      switch (r.behavior) {
        case 'normal':
          r.registered = true;
          break;
        case 'delayed':
          if (r.pendingScans === 0) r.pendingScans = r.delay;
          break;
        case 'popup':
          this.popup = true;
          break;
        case 'dead':
          break;
      }
    });
  }

  /** Total register taps across all rows. */
  get totalRegisterTaps(): number {
    return [...this.registerTaps.values()].reduce((a, b) => a + b, 0);
  }
}

/** Screen source whose "images" are snapshots of the simulated app taken at capture time. */
export class SimScreenSource implements ScreenSource {
  private readonly images = new Map<string, OcrResult>();
  failFrom: number | null = null;

  constructor(private readonly app: SimApp) {}

  async capture(): Promise<string> {
    if (this.failFrom !== null && this.app.captures >= this.failFrom) {
      throw new Error('capture permission was revoked');
    }
    const uri = `sim://image/${this.app.captures + 1}`;
    this.images.set(uri, this.app.snapshot());
    return uri;
  }

  readonly recognizer: TextRecognizer = {
    recognize: async (uri) => {
      const image = this.images.get(uri);
      if (!image) throw new Error(`unknown image ${uri}`);
      return image;
    },
  };
}

export class SimClickAdapter implements ClickAdapter {
  readonly platform = 'android' as const;
  readonly capabilities = {
    crossApp: true,
    supportsDuration: true,
    coordinateSpace: 'screen-pixels' as const,
    description: 'simulated',
  };
  available = true;
  /** Mimics an adapter that cannot reach the tab bar (e.g. iOS with unregistered controls). */
  rejectTabTaps = false;

  constructor(private readonly app: SimApp) {}

  async getAvailability(): Promise<ClickAvailability> {
    return this.available ? { available: true } : { available: false, reason: 'service off' };
  }

  async tap({ x, y }: TapRequest, _ctx: AdapterContext): Promise<void> {
    if (this.rejectTabTaps && y >= TAB_BAR_TOP - 10) {
      throw new ClickError('NO_TARGET', 'no control of this app at that point');
    }
    this.app.tap(x, y);
  }
}
