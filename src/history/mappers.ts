import type { PlaybackResult } from '../macro';
import type { WorkflowResult } from '../workflow';
import type { HistoryError, NewHistoryRecord } from './types';

/** Lỗi của workflow bằng tiếng Việt cho người dùng. Thông báo gốc được giữ trong `details`. */
const ERROR_MESSAGES: Record<string, string> = {
  UNEXPECTED_SCREEN: 'Nội dung màn hình thay đổi bất ngờ',
  NAVIGATION_FAILED: 'Không chuyển được sang tab kế tiếp',
  CLICK_UNAVAILABLE: 'Không thể click (dịch vụ click chưa bật)',
  MAX_CLICKS: 'Đã đạt số click tối đa',
  CAPTURE_FAILED: 'Không chụp được màn hình',
  OCR_FAILED: 'Nhận diện chữ thất bại',
};

/** Turns a Smart Registration Workflow result into a history record. */
export function fromWorkflowResult(result: WorkflowResult, name = 'Đăng ký thông minh'): NewHistoryRecord {
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
      error = { code: 'TIMEOUT', message: result.message ?? 'Dừng do hết thời gian chạy tối đa' };
      break;
    case 'partial':
      status = 'failed';
      error = {
        code: result.reason,
        message:
          failedTargets > 0
            ? `${failedTargets} mục tiêu không đăng ký được`
            : (result.message ?? 'Một số tab không mở được'),
        details: result.tabs.map((t) => `${t.name}: ${t.status}${t.note ? ` (${t.note})` : ''}`).join('\n'),
      };
      break;
    default:
      status = 'failed';
      error = {
        code: result.reason,
        message: (result.reason && ERROR_MESSAGES[result.reason]) || 'Quy trình thất bại',
        details: result.message,
      };
  }

  return {
    kind: 'workflow',
    name: `${name} (đã đăng ký ${registered})`,
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
            message: result.error?.message ?? 'Phát lại thất bại',
            details: result.failedStepId ? `Bước ${result.failedStepId}` : undefined,
          }
        : undefined,
  };
}
