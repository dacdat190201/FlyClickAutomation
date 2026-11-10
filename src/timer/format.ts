/** Formats a duration for a countdown: `m:ss`, or `h:mm:ss` from one hour. Rounds up, so 0 means "now". */
export function formatCountdown(ms: number | null): string {
  if (ms === null) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
