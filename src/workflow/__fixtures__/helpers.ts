import { ClickEngine, type ClickEngineConfig } from '../../click';
import { OcrService } from '../../ocr';
import { SimApp, SimClickAdapter, SimScreenSource } from './sim-app';
import { SmartRegistrationWorkflow, type WorkflowConfig, type WorkflowLogEntry } from '..';

/** Advances fake time until `promise` settles (or fails the test if it never does). */
export async function settle<T>(promise: Promise<T>, stepMs = 25, maxSteps = 40_000): Promise<T> {
  let done = false;
  promise.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < maxSteps && !done; i++) await jest.advanceTimersByTimeAsync(stepMs);
  expect(done).toBe(true);
  return promise;
}

export function build(
  app: SimApp,
  config: Partial<WorkflowConfig> = {},
  click: Partial<ClickEngineConfig> = {},
) {
  const screen = new SimScreenSource(app);
  const adapter = new SimClickAdapter(app);
  const clicker = new ClickEngine(adapter, {
    minIntervalMs: 0,
    retryDelayMs: 0,
    verifyIntervalMs: 50,
    verifyTimeoutMs: 1000,
    ...click,
  });
  const logs: WorkflowLogEntry[] = [];
  const workflow = new SmartRegistrationWorkflow(
    { screen, ocr: new OcrService(screen.recognizer), clicker, onLog: (e) => logs.push(e) },
    {
      targetKeywords: ['Đăng ký'],
      successKeywords: ['Đã đăng ký'],
      tabs: app.tabNames.map((name) => ({ name })),
      settleDelayMs: 10,
      ...config,
    },
  );
  return { workflow, screen, adapter, clicker, logs };
}
