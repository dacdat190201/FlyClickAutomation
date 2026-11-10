import type { PlaybackResult } from '../macro';
import type { WorkflowResult } from '../workflow';
import type { HistoryError, NewHistoryRecord } from './types';

/** Turns a Smart Registration Workflow result into a history record. */
export function fromWorkflowResult(result: WorkflowResult, name = 'Smart registration'): NewHistoryRecord {
  const registered = result.tabs.reduce((n, t) => n + t.registered.length, 0);
  const failedTargets = result.tabs.reduce((n, t) => n + t.failed.length, 0);
  const startedAt = result.log[0]?.time ?? Date.now() - result.durationMs;

  let status: NewHistoryRecord['status'];
  let error: HistoryError | undefined;
  switch (result.status) {
    case 'completed':
      status = 'success';
      break;
    case 'stopped':
      status = 'stopped';
      break;
    case 'timeout':
      status = 'stopped';
      error = { code: 'TIMEOUT', message: result.message ?? 'Stopped at the maximum execution time' };
      break;
    case 'partial':
      status = 'failed';
      error = {
        code: result.reason,
        message:
          failedTargets > 0
            ? `${failedTargets} target(s) could not be registered`
            : (result.message ?? 'Some tabs could not be reached'),
        details: result.tabs.map((t) => `${t.name}: ${t.status}${t.note ? ` (${t.note})` : ''}`).join('\n'),
      };
      break;
    default:
      status = 'failed';
      error = { code: result.reason, message: result.message ?? 'The workflow failed' };
  }

  return {
    kind: 'workflow',
    name: `${name} (${registered} registered)`,
    startedAt,
    durationMs: result.durationMs,
    status,
    clicks: result.clicks,
    error,
  };
}

/**
 * Turns a macro playback into a history record. Playback counts steps, so `clicks` here counts
 * executed steps (waits included) unless `tapCount` says how many of them were taps.
 */
export function fromPlaybackResult(input: {
  name: string;
  startedAt: number;
  durationMs: number;
  result: PlaybackResult;
  tapCount?: number;
}): NewHistoryRecord {
  const { result } = input;
  const succeeded = input.tapCount ?? result.stepsExecuted;
  const failed = result.status === 'failed' ? 1 : 0;
  const code = (result.error as { code?: unknown } | undefined)?.code;

  return {
    kind: 'macro',
    name: input.name,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    status: result.status === 'completed' ? 'success' : result.status === 'stopped' ? 'stopped' : 'failed',
    clicks: { total: succeeded + failed, succeeded, failed },
    error:
      result.status === 'failed'
        ? {
            code: typeof code === 'string' ? code : undefined,
            message: result.error?.message ?? 'Playback failed',
            details: result.failedStepId ? `Step ${result.failedStepId}` : undefined,
          }
        : undefined,
  };
}
