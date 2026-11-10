import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { useTimerSnapshot } from '@/hooks/use-timer-snapshot';
import { useHistory } from '@/providers/app-providers';
import { bindTimerToAppState } from '@/timer/app-state-binding';
import { formatCountdown, TimerEngine, type TimerState } from '@/timer';

const digits = (v: string) => v.replace(/\D/g, '');
/** Blank = `null` (unlimited / once); otherwise seconds converted to ms. */
const seconds = (v: string) => (v === '' ? null : Number(v) * 1000);

const STATE_LABEL: Record<TimerState, string> = {
  IDLE: 'Chưa chạy',
  WAITING: 'Đang chờ bắt đầu',
  RUNNING: 'Đang chạy',
  PAUSED: 'Tạm dừng',
  COMPLETED: 'Hoàn thành',
  STOPPED: 'Đã dừng',
  ERROR: 'Lỗi',
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
  const { add: addHistory } = useHistory();

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
      const next = new TimerEngine(async ({ runIndex }) => {
        const startedAt = Date.now();
        setActionsRun((n) => n + 1);
        // Every run is saved to the history (the demo action sends no clicks).
        await addHistory({
          kind: 'timer',
          name: `Lần chạy hẹn giờ #${runIndex} (demo)`,
          startedAt,
          durationMs: Date.now() - startedAt,
          status: 'success',
        }).catch(() => undefined);
      }, {
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
        Hẹn giờ
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Chỉ chạy hành động demo, không gửi click. Để trống ô để chạy không giới hạn hoặc chạy một lần.
      </ThemedText>

      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="Bắt đầu sau (giây)" keyboardType="number-pad" value={delay} onChangeText={(v) => setDelay(digits(v))} />
        </View>
        <View style={styles.flex}>
          <TextField label="Chạy trong (giây)" placeholder="∞" keyboardType="number-pad" value={duration} onChangeText={(v) => setDuration(digits(v))} />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="Lặp mỗi (giây)" placeholder="một lần" keyboardType="number-pad" value={interval} onChangeText={(v) => setInterval_(digits(v))} />
        </View>
        <View style={styles.flex}>
          <TextField label="Số lần lặp" placeholder="∞" keyboardType="number-pad" value={repeats} onChangeText={(v) => setRepeats(digits(v))} />
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
          {snapshot?.inBackground ? ' (ứng dụng đang ở nền)' : ''}
        </ThemedText>
        <ThemedText type="title" style={[styles.countdown, { color: theme.primary }]}>
          {formatCountdown(snapshot?.countdownMs ?? null)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {snapshot?.state === 'WAITING' ? 'đến lúc bắt đầu' : 'đến lần chạy kế'}
          {snapshot?.remainingMs != null ? ` · còn ${formatCountdown(snapshot.remainingMs)}` : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Đã chạy {snapshot?.runCount ?? 0}
          {snapshot?.maxRepetitions ? ` / ${snapshot.maxRepetitions}` : ''}
          {snapshot?.skippedRuns ? ` · bỏ qua ${snapshot.skippedRuns}` : ''}
          {snapshot?.executing ? ' · đang thực thi…' : ''} · hành động demo: {actionsRun}
        </ThemedText>
        {snapshot?.error && (
          <ThemedText type="small" style={{ color: theme.danger }}>
            {snapshot.error.message}
          </ThemedText>
        )}
      </View>

      <View style={styles.row}>
        <Button title="Bắt đầu" icon="play" disabled={active} onPress={start} style={styles.flex} />
        {state === 'PAUSED' ? (
          <Button title="Tiếp tục" variant="secondary" onPress={() => engine?.resume()} style={styles.flex} />
        ) : (
          <Button title="Tạm dừng" variant="secondary" disabled={!active} onPress={() => engine?.pause()} style={styles.flex} />
        )}
        <Button title="Dừng" icon="stop" variant="danger" disabled={!active} onPress={() => engine?.stop()} style={styles.flex} />
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
