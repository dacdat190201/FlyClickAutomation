import { analyze, cleanKeywords, findMatches } from '..';
import {
  BLANK_SCREEN,
  line,
  REGISTER_SCREEN,
  REGISTER_SCREEN_NO_DIACRITICS,
  screen,
  SUCCESS_SCREEN,
} from '../__fixtures__/screens';

describe('cleanKeywords', () => {
  it('trims, drops empties and removes case-insensitive duplicates', () => {
    expect(cleanKeywords(['  Đăng ký ', '', '   ', 'đăng ký', 'Đăng nhập'])).toEqual([
      'Đăng ký',
      'Đăng nhập',
    ]);
  });
});

describe('findMatches', () => {
  it('matches case-insensitively', () => {
    const matches = findMatches(REGISTER_SCREEN, ['đăng ký']);
    expect(matches.map((m) => m.matchedText)).toEqual(['Đăng ký', 'ĐĂNG KÝ']);
  });

  it('supports partial text matching', () => {
    const [match] = findMatches(REGISTER_SCREEN, ['đăng']);
    expect(match.matchedText).toBe('Đăng');
    expect(match.lineText).toBe('Đăng ký ngay');
  });

  it('returns all matches (multiple buttons) in reading order', () => {
    const matches = findMatches(REGISTER_SCREEN, ['Đăng ký']);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.center!.y)).toEqual([615, 915]); // top-to-bottom
  });

  it('returns several matches within one line', () => {
    const ocr = screen(line('ký ký ký', 0, 0));
    expect(findMatches(ocr, ['ký'])).toHaveLength(3);
  });

  it('searches several keywords at once', () => {
    const matches = findMatches(REGISTER_SCREEN, ['Đăng ký', 'Đăng nhập']);
    expect(matches.map((m) => m.matchedText)).toEqual(['Đăng ký', 'ĐĂNG KÝ', 'Đăng nhập']);
  });

  it('returns the box and centre of only the matched words', () => {
    // "Đăng ký ngay" at left=200: Đăng(200-240) ký(250-270) ngay(280-320)
    const [match] = findMatches(REGISTER_SCREEN, ['Đăng ký']);
    expect(match.box).toEqual({ left: 200, top: 600, width: 70, height: 30 });
    expect(match.center).toEqual({ x: 235, y: 615 });
  });

  it('uses only the matching word when the keyword is one word', () => {
    const [match] = findMatches(REGISTER_SCREEN, ['ngay']);
    expect(match.box).toEqual({ left: 280, top: 600, width: 40, height: 30 });
  });

  it('falls back to the line box when word boxes are missing', () => {
    const ocr = screen({
      text: 'Đăng ký',
      box: { left: 5, top: 6, width: 100, height: 20 },
      words: [],
    });
    const [match] = findMatches(ocr, ['đăng ký']);
    expect(match.box).toEqual({ left: 5, top: 6, width: 100, height: 20 });
  });

  it('returns a null box when there is no geometry at all', () => {
    const [match] = findMatches(screen({ text: 'Đăng ký', words: [] }), ['đăng ký']);
    expect(match.box).toBeNull();
    expect(match.center).toBeNull();
  });

  it('ignores diacritics by default', () => {
    const matches = findMatches(REGISTER_SCREEN_NO_DIACRITICS, ['Đăng ký']);
    expect(matches.map((m) => m.matchedText)).toEqual(['Dang ky']);
  });

  it('respects ignoreDiacritics: false', () => {
    expect(
      findMatches(REGISTER_SCREEN_NO_DIACRITICS, ['Đăng ký'], { ignoreDiacritics: false }),
    ).toEqual([]);
    expect(findMatches(REGISTER_SCREEN, ['đăng ký'], { ignoreDiacritics: false })).toHaveLength(2);
  });

  it('does not confuse different Vietnamese words when diacritics matter', () => {
    const ocr = screen(line('đang ký', 0, 0)); // "đang" (ongoing) vs "đăng" (post)
    expect(findMatches(ocr, ['đăng ký'], { ignoreDiacritics: false })).toEqual([]);
  });

  it('matches across decomposed Unicode input', () => {
    const ocr = screen(line('Đăng ký'.normalize('NFD'), 0, 0));
    expect(findMatches(ocr, ['đăng ký'], { ignoreDiacritics: false })).toHaveLength(1);
  });

  it('supports exact mode: the whole line must equal the keyword', () => {
    const matches = findMatches(REGISTER_SCREEN, ['đăng ký'], { mode: 'exact' });
    expect(matches.map((m) => m.matchedText)).toEqual(['ĐĂNG KÝ']);
  });

  it('returns nothing for empty keywords or an empty screen', () => {
    expect(findMatches(REGISTER_SCREEN, ['', '  '])).toEqual([]);
    expect(findMatches(BLANK_SCREEN, ['đăng ký'])).toEqual([]);
  });
});

describe('analyze', () => {
  const config = { targetKeywords: ['Đăng ký'], successKeywords: ['Đã đăng ký'] };

  it('finds the target buttons on the sign-up screen', () => {
    const result = analyze(REGISTER_SCREEN, config);
    expect(result.status).toBe('target-found');
    expect(result.targets).toHaveLength(2);
    expect(result.successes).toEqual([]);
  });

  it('reports success when the success keyword is present', () => {
    const result = analyze(SUCCESS_SCREEN, config);
    expect(result.status).toBe('success');
    expect(result.successes.map((m) => m.matchedText)).toEqual(['Đã đăng ký']);
  });

  it('does not treat the success text as a target, but keeps genuine buttons', () => {
    // "Đã đăng ký thành công" contains "đăng ký" (not a button); the "Đăng ký" tab at the
    // bottom is a real target.
    const result = analyze(SUCCESS_SCREEN, config);
    expect(result.targets.map((m) => m.lineText)).toEqual(['Đăng ký']);
    expect(result.targets[0].center).toEqual({ x: 75, y: 1515 });
  });

  it('returns not-found when nothing matches', () => {
    expect(analyze(BLANK_SCREEN, config).status).toBe('not-found');
    expect(analyze(REGISTER_SCREEN, { ...config, targetKeywords: ['Thanh toán'] }).status).toBe(
      'not-found',
    );
  });

  it('lets the user configure several success keywords', () => {
    const ocr = screen(line('Registration complete', 0, 0));
    const result = analyze(ocr, {
      targetKeywords: ['Đăng ký'],
      successKeywords: ['Đã đăng ký', 'registration complete'],
    });
    expect(result.status).toBe('success');
  });

  it('passes matching options through', () => {
    const result = analyze(REGISTER_SCREEN_NO_DIACRITICS, {
      ...config,
      ignoreDiacritics: false,
    });
    expect(result.status).toBe('not-found');
  });

  it('works with no keywords configured', () => {
    const result = analyze(REGISTER_SCREEN, { targetKeywords: [], successKeywords: [] });
    expect(result.status).toBe('not-found');
  });
});
