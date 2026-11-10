import { useEffect, useState } from 'react';

import type { TimerEngine, TimerSnapshot } from '@/timer';

/**
 * Live snapshot of a TimerEngine for rendering a countdown. Re-reads on every engine event and
 * on a short interval (the countdown is computed from the clock, not from ticks).
 */
export function useTimerSnapshot(engine: TimerEngine | null, refreshMs = 250): TimerSnapshot | null {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(() => engine?.getSnapshot() ?? null);

  useEffect(() => {
    if (!engine) return;
    const update = () => setSnapshot(engine.getSnapshot());
    const off = engine.subscribe(update);
    const id = setInterval(update, refreshMs);
    return () => {
      off();
      clearInterval(id);
    };
  }, [engine, refreshMs]);

  return engine ? snapshot : null;
}
