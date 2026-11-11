import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { TimerPanel } from '@/components/timer-panel';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { MOCK_TARGETS } from '@/data/mock';
import { useFloatingControls } from '@/hooks/use-floating-controls';
import { useTheme } from '@/hooks/use-theme';
import { useHistory } from '@/providers/app-providers';
import type { IconName } from '@/components/ui/icon';

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const { summary } = useHistory();

  const floating = useFloatingControls({
    running,
    onToggle: useCallback(() => setRunning((r) => !r), []),
  });

  const activeTargets = MOCK_TARGETS.filter((t) => t.enabled);

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
          {activeTargets.length} mục tiêu đang bật · chế độ demo, chưa gửi click thật
        </ThemedText>
      </Card>

      <View style={styles.buttons}>
        <Button
          title="Bắt đầu"
          icon="play"
          size="xl"
          disabled={running}
          onPress={() => setRunning(true)}
          style={styles.flex}
        />
        <Button
          title="Dừng"
          icon="stop"
          size="xl"
          variant="danger"
          disabled={!running}
          onPress={() => setRunning(false)}
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

      <Card>
        <View style={styles.cardHeader}>
          <ThemedText type="default" style={styles.bold}>
            Mục tiêu đang bật
          </ThemedText>
          <Button title="Quản lý" variant="secondary" onPress={() => router.navigate('/targets')} />
        </View>
        {activeTargets.map((t) => (
          <View key={t.id} style={styles.targetRow}>
            <Icon name="target" color={theme.primary} size={20} />
            <ThemedText type="default" style={styles.flex}>
              {t.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              mỗi {t.intervalMs} ms
            </ThemedText>
          </View>
        ))}
      </Card>

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
  bold: { fontWeight: '700' },
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
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
