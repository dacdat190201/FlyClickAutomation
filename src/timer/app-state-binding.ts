import { AppState } from 'react-native';

import type { TimerEngine } from './timer-engine';

/**
 * Connects a TimerEngine to the app lifecycle. Kept out of the barrel (index.ts) so the engine
 * itself stays free of React Native. Returns an unsubscribe function.
 */
export function bindTimerToAppState(engine: TimerEngine): () => void {
  engine.notifyAppState(AppState.currentState ?? 'active');
  const subscription = AppState.addEventListener('change', (status) => engine.notifyAppState(status));
  return () => subscription.remove();
}
