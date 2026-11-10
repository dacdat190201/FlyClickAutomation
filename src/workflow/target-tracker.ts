import type { Point, TextMatch } from '../ocr';

type Entry = {
  center: Point;
  /** Distance within which another match counts as the same target. */
  radius: number;
  text: string;
  attempts: number;
  state: 'attempted' | 'completed' | 'failed';
};

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Remembers which on-screen targets have been tried, so a target that was registered (or given
 * up on) is never clicked again. Targets are identified by position, because identical buttons
 * ("Đăng ký" in every row) differ only in where they are. One tracker per tab.
 */
export class TargetTracker {
  private readonly entries: Entry[] = [];

  private find(center: Point): Entry | undefined {
    return this.entries.find((e) => distance(e.center, center) <= e.radius);
  }

  /** True if the target at this match was already completed or given up on. */
  isDone(match: TextMatch): boolean {
    const entry = match.center ? this.find(match.center) : undefined;
    return entry?.state === 'completed' || entry?.state === 'failed';
  }

  /** Records an attempt and returns the attempt number (1 for the first). */
  recordAttempt(match: TextMatch): number {
    const center = match.center!;
    let entry = this.find(center);
    if (!entry) {
      entry = {
        center,
        radius: Math.max(12, match.box?.height ?? 0),
        text: match.matchedText,
        attempts: 0,
        state: 'attempted',
      };
      this.entries.push(entry);
    }
    return ++entry.attempts;
  }

  markCompleted(center: Point): void {
    const entry = this.find(center);
    if (entry) entry.state = 'completed';
  }

  markFailed(center: Point): void {
    const entry = this.find(center);
    if (entry) entry.state = 'failed';
  }

  attemptsFor(center: Point): number {
    return this.find(center)?.attempts ?? 0;
  }

  /** Targets that were clicked but not confirmed yet. */
  unconfirmed(): { center: Point; radius: number; text: string; attempts: number }[] {
    return this.entries.filter((e) => e.state === 'attempted');
  }
}
