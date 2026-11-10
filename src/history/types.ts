export const HISTORY_SCHEMA_VERSION = 1;

export type HistoryKind = 'click' | 'workflow' | 'macro' | 'timer';
export type HistoryStatus = 'success' | 'failed' | 'stopped';

export type HistoryError = {
  code?: string;
  message: string;
  details?: string;
};

export type ClickCounts = { total: number; succeeded: number; failed: number };

/** One execution (a workflow run, a macro playback, a timer run, ...). */
export type HistoryRecord = {
  id: string;
  kind: HistoryKind;
  name: string;
  /** Epoch ms. */
  startedAt: number;
  durationMs: number;
  status: HistoryStatus;
  clicks: ClickCounts;
  error?: HistoryError;
};

export type NewHistoryRecord = Omit<HistoryRecord, 'id' | 'clicks'> & {
  id?: string;
  clicks?: Partial<ClickCounts>;
};

export type HistoryFilter = {
  status?: HistoryStatus;
  kind?: HistoryKind;
  /** Inclusive epoch ms bounds on `startedAt`. */
  since?: number;
  until?: number;
};

export type HistorySummary = {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  stoppedExecutions: number;
  totalClicks: number;
  successfulClicks: number;
  failedClicks: number;
  totalDurationMs: number;
  averageDurationMs: number;
  lastExecutionAt: number | null;
};

export const HISTORY_LIMITS = {
  /** Oldest records are dropped beyond this. */
  maxRecords: 500,
  maxNameLength: 200,
  maxMessageLength: 500,
  maxDetailsLength: 2000,
} as const;
