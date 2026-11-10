import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { useTimerSnapshot } from '@/hooks/use-timer-snapshot';
import { bindTimerToAppState } from '@/timer/app-state-binding';
import { formatCountdown, TimerEngine, type TimerState } from '@/timer';

const digits = (v: string) => v.replace(/\D/g, '');
/** Blank = `null` (unlimited / once); otherwise seconds converted to ms. */
const seconds = (v: string) => (v === '' ? null : Number(v) * 1000);

const STATE_LABEL: Record<TimerState, string> = {
  IDLE: 'Idle',
  WAITING: 'Waiting to start',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  STOPPED: 'Stopped',
  ERROR: 'Error',
};

/**
 * Configures and runs a TimerEngine and shows its countdown and status. The action is a demo
 * counter: no clicks are sent. Wire a real action (e.g. the registration workflow) later.
 */
export function TimerPanel() {
  const theme = useTheme();
  const [delay, setDelay] = useState('5');
  const [duration, setDuration] = useState('');
  const [interval, setInterval_] = useState('2');
  const [repeats, setRepeats] = useState('5');
  const [actionsRun, setActionsRun] = useState(0);
  const [engine, setEngine] = useState<TimerEngine | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const snapshot = useTimerSnapshot(engine);

  // Tell the engine when the app goes to the background / returns, and clean up on unmount.
  useEffect(() => {
    if (!engine) return;
    const unbind = bindTimerToAppState(engine);
    return () => {
      unbind();
      engine.stop();
    };
  }, [engine]);

  const start = () => {
    try {
      engine?.stop();
      setActionsRun(0);
      const next = new TimerEngine(() => setActionsRun((n) => n + 1), {
        startDelayMs: Number(delay || 0) * 1000,
        durationMs: seconds(duration),
        intervalMs: seconds(interval),
        maxRepetitions: repeats === '' ? null : Number(repeats),
      });
      next.start();
      setEngine(next);
      setConfigError(null);
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : String(e));
    }
  };

  const state = snapshot?.state ?? 'IDLE';
  const active = state === 'WAITING' || state === 'RUNNING' || state === 'PAUSED';

  return (
    <Card>
      <ThemedText type="default" style={styles.bold}>
        Timer
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Demo action only, no clicks are sent. Leave a field blank for unlimited or once.
      </ThemedText>

      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="Start after (s)" keyboardType="number-pad" value={delay} onChangeText={(v) => setDelay(digits(v))} />
        </View>
        <View style={styles.flex}>
          <TextField label="Run for (s)" placeholder="∞" keyboardType="number-pad" value={duration} onChangeText={(v) => setDuration(digits(v))} />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="Every (s)" placeholder="once" keyboardType="number-pad" value={interval} onChangeText={(v) => setInterval_(digits(v))} />
        </View>
        <View style={styles.flex}>
          <TextField label="Repeats" placeholder="∞" keyboardType="number-pad" value={repeats} onChangeText={(v) => setRepeats(digits(v))} />
        </View>
      </View>

      {configError && (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {configError}
        </ThemedText>
      )}

      <View style={[styles.display, { backgroundColor: theme.primarySoft }]}>
        <ThemedText type="small" style={{ color: theme.primary }}>
          {STATE_LABEL[state]}
          {snapshot?.inBackground ? ' (app in background)' : ''}
        </ThemedText>
        <ThemedText type="title" style={[styles.countdown, { color: theme.primary }]}>
          {formatCountdown(snapshot?.countdownMs ?? null)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {snapshot?.state === 'WAITING' ? 'until start' : 'until next run'}
          {snapshot?.remainingMs != null ? ` · ${formatCountdown(snapshot.remainingMs)} left` : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Runs {snapshot?.runCount ?? 0}
          {snapshot?.maxRepetitions ? ` / ${snapshot.maxRepetitions}` : ''}
          {snapshot?.skippedRuns ? ` · skipped ${snapshot.skippedRuns}` : ''}
          {snapshot?.executing ? ' · executing…' : ''} · demo actions: {actionsRun}
        </ThemedText>
        {snapshot?.error && (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {snapshot.error.message}
          </ThemedText>
        )}
      </View>

      <View style={styles.row}>
        <Button title="Start" icon="play" disabled={active} onPress={start} style={styles.flex} />
        {state === 'PAUSED' ? (
          <Button title="Resume" variant="secondary" onPress={() => engine?.resume()} style={styles.flex} />
        ) : (
          <Button title="Pause" variant="secondary" disabled={!active} onPress={() => engine?.pause()} style={styles.flex} />
        )}
        <Button title="Stop" icon="stop" variant="danger" disabled={!active} onPress={() => engine?.stop()} style={styles.flex} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12 },
  display: { borderRadius: 16, padding: 16, alignItems: 'center', gap: 4 },
  countdown: { fontSize: 44, lineHeight: 50 },
});
