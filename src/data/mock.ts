// Mock data only. No real clicking or OCR is implemented yet.

export type Target = {
  id: string;
  name: string;
  x: number;
  y: number;
  intervalMs: number;
  enabled: boolean;
};

export type TextRule = {
  id: string;
  keyword: string;
  action: string;
  enabled: boolean;
};

export type LogEntry = {
  id: string;
  message: string;
  time: string;
  status: 'success' | 'failed';
};

export const MOCK_STATS = {
  clicksToday: 128,
  successRate: '96%',
  uptime: '02:14:09',
};

export const MOCK_TARGETS: Target[] = [
  { id: 't1', name: 'Accept button', x: 540, y: 1820, intervalMs: 800, enabled: true },
  { id: 't2', name: 'Claim reward', x: 320, y: 960, intervalMs: 1500, enabled: true },
  { id: 't3', name: 'Close popup', x: 980, y: 210, intervalMs: 2000, enabled: false },
];

export const MOCK_RULES: TextRule[] = [
  { id: 'r1', keyword: 'Accept', action: 'Tap match', enabled: true },
  { id: 'r2', keyword: 'Continue', action: 'Tap match', enabled: true },
  { id: 'r3', keyword: 'Error', action: 'Stop automation', enabled: false },
];

export const MOCK_LOGS: LogEntry[] = [
  { id: 'l1', message: 'Clicked "Accept button"', time: '10:42:18', status: 'success' },
  { id: 'l2', message: 'Clicked "Claim reward"', time: '10:42:16', status: 'success' },
  { id: 'l3', message: 'Text "Continue" not found', time: '10:42:10', status: 'failed' },
  { id: 'l4', message: 'Clicked "Accept button"', time: '10:41:58', status: 'success' },
  { id: 'l5', message: 'Automation started', time: '10:41:50', status: 'success' },
  { id: 'l6', message: 'Click missed target "Close popup"', time: '10:38:02', status: 'failed' },
  { id: 'l7', message: 'Automation stopped', time: '10:35:44', status: 'success' },
];
