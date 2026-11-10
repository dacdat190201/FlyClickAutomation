import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { MOCK_LOGS, type LogEntry } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';

const FILTERS = ['all', 'success', 'failed'] as const;
type Filter = (typeof FILTERS)[number];

export default function LogsScreen() {
  const theme = useTheme();
  const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOGS);
  const [filter, setFilter] = useState<Filter>('all');

  const visible = filter === 'all' ? logs : logs.filter((l) => l.status === filter);

  return (
    <Screen
      title="Logs"
      subtitle={`${logs.length} events`}
      action={
        <Button
          title="Clear"
          icon="trash"
          variant="secondary"
          disabled={logs.length === 0}
          onPress={() => setLogs([])}
        />
      }>
      <View style={[styles.segment, { backgroundColor: theme.backgroundElement }]}>
        {FILTERS.map((f) => {
          const active = f === filter;
          return (
            <Pressable
              key={f}
              accessibilityRole="button"
              onPress={() => setFilter(f)}
              style={[styles.segmentItem, active && { backgroundColor: theme.primary }]}>
              <ThemedText
                type="smallBold"
                style={{ color: active ? theme.onPrimary : theme.textSecondary }}>
                {f[0].toUpperCase() + f.slice(1)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      <Card style={styles.list}>
        {visible.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No events to show.
          </ThemedText>
        )}
        {visible.map((l, i) => (
          <View
            key={l.id}
            style={[
              styles.row,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
            ]}>
            <Icon
              name={l.status === 'success' ? 'check' : 'error'}
              color={l.status === 'success' ? theme.success : theme.danger}
              size={22}
            />
            <ThemedText type="default" style={styles.message}>
              {l.message}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {l.time}
            </ThemedText>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', padding: 4, borderRadius: 14 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10 },
  list: { gap: 0, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  message: { flex: 1 },
  empty: { textAlign: 'center', paddingVertical: 20 },
});
