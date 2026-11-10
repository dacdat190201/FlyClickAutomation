import { findMatches } from '../../ocr';
import { REGISTER_SCREEN, SUCCESS_SCREEN, line, screen } from '../../ocr/__fixtures__/screens';
import { fingerprint, similarity, TargetTracker } from '..';

describe('fingerprint / similarity', () => {
  it('ignores lines that contain a keyword (they are expected to change)', () => {
    const fp = fingerprint(REGISTER_SCREEN, ['Đăng ký', 'Đã đăng ký']);
    expect([...fp].sort()).toEqual(['chao mung ban', 'dang nhap']);
  });

  it('is case- and diacritic-insensitive', () => {
    const a = fingerprint(screen(line('Khóa học 1', 0, 0)));
    const b = fingerprint(screen(line('KHOA HOC 1', 0, 0)));
    expect(similarity(a, b)).toBe(1);
  });

  it('computes Jaccard similarity', () => {
    expect(similarity(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(similarity(new Set(['a', 'b']), new Set(['c']))).toBe(0);
    expect(similarity(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3);
    expect(similarity(new Set(), new Set())).toBe(1);
    expect(similarity(new Set(['a']), new Set())).toBe(0);
  });

  it('treats the register and success screens as the same page apart from keyword lines', () => {
    const kw = ['Đăng ký', 'Đã đăng ký'];
    const a = fingerprint(screen(line('Tiêu đề', 0, 0), line('Đăng ký', 0, 50)), kw);
    const b = fingerprint(screen(line('Tiêu đề', 0, 0), line('Đã đăng ký', 0, 50)), kw);
    expect(similarity(a, b)).toBe(1);
    // sanity: success screen from the fixtures does contain the success keyword
    expect(findMatches(SUCCESS_SCREEN, ['Đã đăng ký'])).toHaveLength(1);
  });
});

describe('TargetTracker', () => {
  const [first, second] = findMatches(REGISTER_SCREEN, ['Đăng ký']);

  it('counts attempts per target position', () => {
    const tracker = new TargetTracker();
    expect(tracker.recordAttempt(first)).toBe(1);
    expect(tracker.recordAttempt(first)).toBe(2);
    expect(tracker.recordAttempt(second)).toBe(1);
    expect(tracker.attemptsFor(first.center!)).toBe(2);
  });

  it('recognises the same target even if OCR jitters by a few pixels', () => {
    const tracker = new TargetTracker();
    tracker.recordAttempt(first);
    tracker.markCompleted(first.center!);
    const jittered = { ...first, center: { x: first.center!.x + 4, y: first.center!.y - 3 } };
    expect(tracker.isDone(jittered)).toBe(true);
  });

  it('never reports a completed or failed target as pending again', () => {
    const tracker = new TargetTracker();
    tracker.recordAttempt(first);
    tracker.recordAttempt(second);
    tracker.markCompleted(first.center!);
    tracker.markFailed(second.center!);
    expect(tracker.isDone(first)).toBe(true);
    expect(tracker.isDone(second)).toBe(true);
    expect(tracker.unconfirmed()).toEqual([]);
  });

  it('keeps attempted-but-unconfirmed targets visible, and not done', () => {
    const tracker = new TargetTracker();
    tracker.recordAttempt(first);
    expect(tracker.isDone(first)).toBe(false);
    expect(tracker.unconfirmed()).toHaveLength(1);
  });

  it('does not confuse distant targets', () => {
    const tracker = new TargetTracker();
    tracker.recordAttempt(first);
    tracker.markCompleted(first.center!);
    expect(tracker.isDone(second)).toBe(false);
  });
});
