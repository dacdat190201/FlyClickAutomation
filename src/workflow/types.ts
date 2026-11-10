/**
 * Types of the Smart Registration Workflow. Pure TypeScript: it only depends on the engine,
 * ocr and click modules through their public interfaces.
 */
import type { ClickEngine } from '../click';
import type { MatchMode, OcrService, Point } from '../ocr';

/** Where screen images come from. Implementations must only return images the app is authorised to read. */
export interface ScreenSource {
  /** Captures the current screen and returns the image URI (readable by the OCR service). */
  capture(signal: AbortSignal): Promise<string>;
}

export type TabConfig = {
  /** Display name used in logs and results. */
  name: string;
  /** Text of the tab button to click (found with OCR). Defaults to `name`. */
  label?: string;
  /** Text that must appear once the tab is open. If omitted, "the screen changed" is the check. */
  verifyKeyword?: string;
};

export type WorkflowConfig = {
  /** Button text to look for, e.g. "Đăng ký". */
  targetKeywords: string[];
  /** Text that proves a registration worked, e.g. "Đã đăng ký". */
  successKeywords: string[];
  /** Tabs to process in order. At least one. The first is assumed to be on screen already. */
  tabs: TabConfig[];
  ignoreDiacritics?: boolean;
  mode?: MatchMode;

  /** Extra attempts per target after a failed one. Default 2 (3 attempts in total). */
  maxRetriesPerTarget: number;
  /** Hard limit for the whole run. Default 10 minutes. */
  maxExecutionMs: number;
  /** Hard limit on clicks (targets and tabs), so the loop always terminates. Default 500. */
  maxClicks: number;
  /** Pause after a click before the first verification scan. Default 300. */
  settleDelayMs: number;
  /**
   * Stop when the unrelated screen content changes this much between scans
   * (0..1 similarity of the non-keyword lines). Default 0.5.
   */
  minScreenSimilarity: number;
  /** A success text counts as "next to the target" within this many target heights. Default 2. */
  verifyRadiusFactor: number;
  /** When several matches exist for a tab label, click the first (top) or last (bottom). Default `last`. */
  tabLabelPick: 'first' | 'last';
  /** Also navigate to the first tab instead of assuming it is already open. Default false. */
  navigateFirstTab: boolean;
};

export type WorkflowDeps = {
  screen: ScreenSource;
  ocr: OcrService;
  /** Configure it with `maxRetries: 0` and a `verifyTimeoutMs` long enough for the UI to update. */
  clicker: ClickEngine;
  now?: () => number;
  /** Called for every log entry as it is written. */
  onLog?: (entry: WorkflowLogEntry) => void;
};

export type LogLevel = 'info' | 'warn' | 'error';

/** Step names follow the workflow: capture, ocr, find, select, click, wait, verify, mark, next, navigate, safeguard, run. */
export type WorkflowLogEntry = {
  time: number;
  level: LogLevel;
  step: string;
  message: string;
  data?: Record<string, unknown>;
};

export type WorkflowErrorCode =
  | 'UNEXPECTED_SCREEN'
  | 'NAVIGATION_FAILED'
  | 'CLICK_UNAVAILABLE'
  | 'MAX_CLICKS'
  | 'CAPTURE_FAILED'
  | 'OCR_FAILED';

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

export type TargetRecord = {
  text: string;
  center: Point;
  attempts: number;
  /** Time the outcome was recorded. */
  at: number;
};

export type TabStatus = 'pending' | 'running' | 'completed' | 'failed' | 'not-reached' | 'stopped';

export type TabResult = {
  name: string;
  status: TabStatus;
  /** Targets confirmed as registered (each clicked at most once successfully). */
  registered: TargetRecord[];
  /** Targets given up on after the retry limit. */
  failed: TargetRecord[];
  note?: string;
};

export type WorkflowStatus = 'completed' | 'partial' | 'stopped' | 'timeout' | 'failed';

export type WorkflowResult = {
  /**
   * `completed`: every tab processed and every target registered.
   * `partial`: finished, but some target failed or a tab could not be reached.
   */
  status: WorkflowStatus;
  reason?: WorkflowErrorCode | 'NAVIGATION_UNSUPPORTED' | 'TARGET_FAILED' | 'ERROR';
  message?: string;
  tabs: TabResult[];
  totalClicks: number;
  durationMs: number;
  log: WorkflowLogEntry[];
};
