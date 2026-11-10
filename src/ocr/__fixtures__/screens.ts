import type { OcrLine, OcrResult } from '../types';

const CHAR_WIDTH = 10;
const LINE_HEIGHT = 30;

/**
 * Builds an OCR line the way ML Kit reports it: one box per word, plus a box for the line.
 * Words are laid out left to right with a 1-character gap, 10px per character.
 */
export function line(text: string, left: number, top: number): OcrLine {
  let cursor = left;
  const words = text.split(' ').map((word) => {
    const width = word.length * CHAR_WIDTH;
    const box = { left: cursor, top, width, height: LINE_HEIGHT };
    cursor += width + CHAR_WIDTH;
    return { text: word, box };
  });
  const last = words[words.length - 1].box!;
  return {
    text,
    box: { left, top, width: last.left + last.width - left, height: LINE_HEIGHT },
    words,
  };
}

export function screen(...lines: OcrLine[]): OcrResult {
  return { text: lines.map((l) => l.text).join('\n'), lines };
}

/*
 * Synthetic stand-ins for OCR output of sample screenshots. They mirror the structure of real
 * ML Kit results (lines with per-word boxes) but were not produced by the native engine.
 */

/** Sign-up screen with two "register" buttons and an unrelated login button. */
export const REGISTER_SCREEN = screen(
  line('Chào mừng bạn', 100, 120),
  line('Đăng ký ngay', 200, 600),
  line('ĐĂNG KÝ', 220, 900),
  line('Đăng nhập', 230, 1100),
);

/** After tapping: confirmation text, plus a leftover "Đăng ký" tab label. */
export const SUCCESS_SCREEN = screen(
  line('Đã đăng ký thành công', 80, 400),
  line('Đăng ký', 40, 1500),
);

/** Same sign-up screen, OCR lost every diacritic. */
export const REGISTER_SCREEN_NO_DIACRITICS = screen(
  line('Chao mung ban', 100, 120),
  line('Dang ky', 220, 900),
);

export const BLANK_SCREEN = screen();
