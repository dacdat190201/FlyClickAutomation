import {
  HISTORY_LIMITS,
  type ClickCounts,
  type HistoryError,
  type HistoryFilter,
  type HistoryKind,
  type HistoryRecord,
  type HistoryStatus,
  type HistorySummary,
} from './types';

const KINDS: readonly HistoryKind[] = ['click', 'workflow', 'macro', 'timer'];
const STATUSES: readonly HistoryStatus[] = ['success', 'failed', 'stopped'];

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function cleanError(raw: unknown): HistoryError | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const e = raw as Record<string, unknown>;
  if (typeof e.message !== 'string') return undefined;
  return {
    ...(typeof e.code === 'string' ? { code: clip(e.code, 60) } : {}),
    message: clip(e.message, HISTORY_LIMITS.maxMessageLength),
    ...(typeof e.details === 'string' ? { details: clip(e.details, HISTORY_LIMITS.maxDetailsLength) } : {}),
  };
}

/**
 * Builds a valid record from untrusted input (a caller, or stored data). Returns null if the
 * essentials (kind, status, time) are unusable. Counts are made consistent and text is clipped.
 */
export function sanitizeRecord(raw: unknown, id: string): HistoryRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!KINDS.includes(r.kind as HistoryKind) || !STATUSES.includes(r.status as HistoryStatus)) return null;
  if (typeof r.startedAt !== 'number' || !Number.isFinite(r.startedAt) || r.startedAt < 0) return null;

  const clicksIn = (typeof r.clicks === 'object' && r.clicks !== null ? r.clicks : {}) as Record<string, unknown>;
  const succeeded = count(clicksIn.succeeded);
  const failed = count(clicksIn.failed);
  const clicks: ClickCounts = { total: Math.max(count(clicksIn.total), succeeded + failed), succeeded, failed };

  const error = cleanError(r.error);
  return {
    id: typeof r.id === 'string' && r.id ? r.id : id,
    kind: r.kind as HistoryKind,
    name: clip(typeof r.name === 'string' && r.name ? r.name : String(r.kind), HISTORY_LIMITS.maxNameLength),
    startedAt: r.startedAt,
    durationMs: count(r.durationMs),
    status: r.status as HistoryStatus,
    clicks,
    ...(error ? { error } : {}),
  };
}

export function matchesFilter(record: HistoryRecord, filter: HistoryFilter = {}): boolean {
  return (
    (filter.status === undefined || record.status === filter.status) &&
    (filter.kind === undefined || record.kind === filter.kind) &&
    (filter.since === undefined || record.startedAt >= filter.since) &&
    (filter.until === undefined || record.startedAt <= filter.until)
  );
}

export function summarize(records: readonly HistoryRecord[]): HistorySummary {
  const summary: HistorySummary = {
    totalExecutions: records.length,
    successfulExecutions: 0,
    failedExecutions: 0,
    stoppedExecutions: 0,
    totalClicks: 0,
    successfulClicks: 0,
    failedClicks: 0,
    totalDurationMs: 0,
    averageDurationMs: 0,
    lastExecutionAt: null,
  };
  for (const r of records) {
    if (r.status === 'success') summary.successfulExecutions++;
    else if (r.status === 'failed') summary.failedExecutions++;
    else summary.stoppedExecutions++;
    summary.totalClicks += r.clicks.total;
    summary.successfulClicks += r.clicks.succeeded;
    summary.failedClicks += r.clicks.failed;
    summary.totalDurationMs += r.durationMs;
    if (summary.lastExecutionAt === null || r.startedAt > summary.lastExecutionAt) summary.lastExecutionAt = r.startedAt;
  }
  summary.averageDurationMs = records.length ? Math.round(summary.totalDurationMs / records.length) : 0;
  return summary;
}
