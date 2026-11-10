import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { TimerPanel } from '@/components/timer-panel';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { MOCK_STATS, MOCK_TARGETS } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [running, setRunning] = useState(false);

  const activeTargets = MOCK_TARGETS.filter((t) => t.enabled);

  return (
    <Screen title="FlyClick" subtitle="Automation dashboard">
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
            {running ? 'Running' : 'Stopped'}
          </ThemedText>
        </View>
        <ThemedText type="subtitle" style={styles.statusTitle}>
          {running ? 'Automation is active' : 'Ready to start'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {activeTargets.length} active targets · demo mode, no real clicks are sent
        </ThemedText>
      </Card>

      <View style={styles.buttons}>
        <Button
          title="Start"
          icon="play"
          size="xl"
          disabled={running}
          onPress={() => setRunning(true)}
          style={styles.flex}
        />
        <Button
          title="Stop"
          icon="stop"
          size="xl"
          variant="danger"
          disabled={!running}
          onPress={() => setRunning(false)}
          style={styles.flex}
        />
      </View>

      <View style={styles.stats}>
        <StatCard icon="bolt" label="Clicks today" value={String(MOCK_STATS.clicksToday)} />
        <StatCard icon="check" label="Success" value={MOCK_STATS.successRate} />
        <StatCard icon="timer" label="Uptime" value={running ? MOCK_STATS.uptime : '00:00:00'} />
      </View>

      <Card>
        <View style={styles.cardHeader}>
          <ThemedText type="default" style={styles.bold}>
            Active targets
          </ThemedText>
          <Button title="Manage" variant="secondary" onPress={() => router.navigate('/targets')} />
        </View>
        {activeTargets.map((t) => (
          <View key={t.id} style={styles.targetRow}>
            <Icon name="target" color={theme.primary} size={20} />
            <ThemedText type="default" style={styles.flex}>
              {t.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              every {t.intervalMs} ms
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
  icon: 'bolt' | 'check' | 'timer';
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
