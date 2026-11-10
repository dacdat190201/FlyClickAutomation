import { normalize } from '..';

describe('normalize', () => {
  it('lower-cases', () => {
    expect(normalize('ĐĂNG KÝ', false).text).toBe('đăng ký');
  });

  it('collapses whitespace and trims', () => {
    expect(normalize('  đăng \t  ký \n', false).text).toBe('đăng ký');
  });

  it('keeps diacritics when ignoreDiacritics is false', () => {
    expect(normalize('Đã đăng ký', false).text).toBe('đã đăng ký');
  });

  it('strips diacritics and maps đ to d when ignoreDiacritics is true', () => {
    expect(normalize('Đã đăng ký', true).text).toBe('da dang ky');
  });

  it('treats decomposed (NFD) and precomposed (NFC) Vietnamese the same', () => {
    const composed = 'Đăng ký';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    expect(normalize(decomposed, false).text).toBe(normalize(composed, false).text);
    expect(normalize(decomposed, true).text).toBe('dang ky');
  });

  it('maps every normalised character back to the original string', () => {
    const original = '  Đã   đăng ký';
    const n = normalize(original, true);
    expect(n.text).toBe('da dang ky');
    // "dang" starts at the original "đ" of "đăng" (index 7)
    const at = n.text.indexOf('dang');
    expect(original.slice(n.starts[at], n.ends[at + 3])).toBe('đăng');
  });

  it('handles empty and whitespace-only input', () => {
    expect(normalize('', false).text).toBe('');
    expect(normalize('   ', false).text).toBe('');
  });
});
