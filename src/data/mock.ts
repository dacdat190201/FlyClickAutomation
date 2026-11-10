// Mock data only. No real clicking or OCR is implemented yet.

export type Target = {
  id: string;
  name: string;
  x: number;
  y: number;
  intervalMs: number;
  enabled: boolean;
};

export const MOCK_TARGETS: Target[] = [
  { id: 't1', name: 'Accept button', x: 540, y: 1820, intervalMs: 800, enabled: true },
  { id: 't2', name: 'Claim reward', x: 320, y: 960, intervalMs: 1500, enabled: true },
  { id: 't3', name: 'Close popup', x: 980, y: 210, intervalMs: 2000, enabled: false },
];

