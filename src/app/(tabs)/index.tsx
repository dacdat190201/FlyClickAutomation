import { useCallback } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { TimerPanel } from '@/components/timer-panel';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { AutoConfigCard } from '@/components/auto-config-card';
import { Screen } from '@/components/ui/screen';
import { useAutoRunner, type StartFailure } from '@/hooks/use-auto-runner';
import { useFloatingControls } from '@/hooks/use-floating-controls';
import { useTheme } from '@/hooks/use-theme';
import { useHistory } from '@/providers/app-providers';
import type { IconName } from '@/components/ui/icon';

export default function HomeScreen() {
  const theme = useTheme();
  const { summary } = useHistory();
  const auto = useAutoRunner();
  const { running } = auto;

  const begin = useCallback(async () => {
    const failure: StartFailure = await auto.start();
    if (failure === 'service-off') {
      Alert.alert('Chưa bật dịch vụ', 'Hãy bật FlyClick trong Cài đặt → Trợ năng, rồi thử lại.', [
        { text: 'Để sau', style: 'cancel' },
        { text: 'Mở Cài đặt', onPress: auto.openAccessibilitySettings },
      ]);
    } else if (failure === 'no-points') {
      Alert.alert('Chưa có điểm click', 'Bấm "Chọn điểm" (hoặc nút ◎ trên thanh nổi) để chọn vị trí cần click.');
    } else if (failure === 'unsupported') {
      Alert.alert('Không hỗ trợ', 'Tính năng này chỉ chạy trên Android (bản development build).');
    }
  }, [auto]);

  const floating = useFloatingControls({
    running,
    onToggle: useCallback(() => (running ? auto.stop() : void begin()), [running, auto, begin]),
    onPick: useCallback(() => void auto.togglePicker(), [auto]),
  });

  return (
    <Screen title="FlyClick" subtitle="Bảng điều khiển tự động hóa">
      <Card style={styles.statusCard}>
        <View
          style={[
            styles.pill,
            { backgroundColor: running ? theme.successSoft : theme.backgroundElement },
          ]}>
          <View
            style={[styles.dot, { backgroundColor: running ? theme.success : theme.textSecondary }]}
          />
          <ThemedText type="smallBold" style={{ color: running ? theme.success : theme.textSecondary }}>
            {running ? 'Đang chạy' : 'Đã dừng'}
          </ThemedText>
        </View>
        <ThemedText type="subtitle" style={styles.statusTitle}>
          {running ? 'Tự động hóa đang hoạt động' : 'Sẵn sàng bắt đầu'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {auto.config.mode === 'points'
            ? `${auto.config.points.length} điểm click · ${auto.config.pointRounds === 0 ? 'lặp đến khi dừng' : `${auto.config.pointRounds} vòng`}`
            : `${auto.config.tabs.length} tab · tìm “${auto.config.targetKeywords.join(', ')}” rồi bấm cho đến khi thành “${auto.config.successKeywords.join(', ')}”`}
        </ThemedText>
      </Card>

      <View style={styles.buttons}>
        <Button
          title="Bắt đầu"
          icon="play"
          size="xl"
          disabled={running}
          onPress={begin}
          style={styles.flex}
        />
        <Button
          title="Dừng"
          icon="stop"
          size="xl"
          variant="danger"
          disabled={!running}
          onPress={auto.stop}
          style={styles.flex}
        />
      </View>

      {floating.available && (
        <Button
          title="Hiện thanh điều khiển nổi"
          icon="bolt"
          variant="secondary"
          onPress={async () => {
            if (!(await floating.show())) {
              Alert.alert('Chưa bật dịch vụ', 'Hãy bật FlyClick trong Cài đặt → Trợ năng, rồi thử lại.');
            }
          }}
        />
      )}

      <View style={styles.stats}>
        <StatCard icon="bolt" label="Lần chạy" value={String(summary.totalExecutions)} />
        <StatCard icon="check" label="Click thành công" value={String(summary.successfulClicks)} />
        <StatCard icon="error" label="Click lỗi" value={String(summary.failedClicks)} />
      </View>

      <AutoConfigCard
        key={auto.loaded ? 'ready' : 'loading'}
        config={auto.config}
        onChange={auto.setConfig}
        running={running}
        progress={auto.progress}
        result={auto.result}
        pickerOpen={auto.pickerOpen}
        onTogglePicker={() => void auto.togglePicker()}
      />

      <TimerPanel />
    </Screen>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <Card style={styles.statCard}>
      <Icon name={icon} color={theme.primary} size={20} />
      <ThemedText type="subtitle" style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  statusCard: { alignItems: 'flex-start', paddingVertical: 20 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusTitle: { fontSize: 24, lineHeight: 30 },
  buttons: { flexDirection: 'row', gap: 12 },
  stats: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1, padding: 14, gap: 6 },
  statValue: { fontSize: 22, lineHeight: 28 },
});
