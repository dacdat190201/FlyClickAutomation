export type Normalized = {
  /** Lower-cased text, whitespace collapsed to single spaces, optionally without diacritics. */
  text: string;
  /** For each UTF-16 unit of `text`: start index of the source character in the original string. */
  starts: number[];
  /** For each UTF-16 unit of `text`: end index (exclusive) of the source character. */
  ends: number[];
};

const WHITESPACE = /\s/u;
const COMBINING_MARK = /\p{M}/u;

/** Splits into code points, attaching combining marks to the preceding base character. */
function groups(input: string): { start: number; end: number; value: string }[] {
  const result: { start: number; end: number; value: string }[] = [];
  let index = 0;
  for (const ch of input) {
    const start = index;
    index += ch.length;
    const last = result[result.length - 1];
    if (last && COMBINING_MARK.test(ch)) {
      last.value += ch;
      last.end = index;
    } else {
      result.push({ start, end: index, value: ch });
    }
  }
  return result;
}

/**
 * Normalises text for matching while remembering where every normalised character came from,
 * so a match can be mapped back to the original string (and from there to word boxes).
 *
 * Handles precomposed and decomposed Vietnamese (NFC/NFD), "đ"/"Đ", and any whitespace.
 */
export function normalize(input: string, ignoreDiacritics: boolean): Normalized {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];

  const push = (chars: string, start: number, end: number) => {
    for (let i = 0; i < chars.length; i++) {
      text += chars[i];
      starts.push(start);
      ends.push(end);
    }
  };

  for (const g of groups(input)) {
    if (WHITESPACE.test(g.value)) {
      if (text.length > 0 && !text.endsWith(' ')) push(' ', g.start, g.end);
      continue;
    }
    let value = g.value.normalize('NFC').toLowerCase();
    if (ignoreDiacritics) {
      value = value.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
    } else {
      value = value.normalize('NFC');
    }
    push(value, g.start, g.end);
  }

  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    starts.pop();
    ends.pop();
  }
  return { text, starts, ends };
}
