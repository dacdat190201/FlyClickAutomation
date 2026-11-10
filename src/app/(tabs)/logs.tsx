import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { formatDuration, matchesFilter, summarize, type HistoryRecord, type HistoryStatus } from '@/history';
import { useTheme } from '@/hooks/use-theme';
import { useHistory } from '@/providers/app-providers';

type Filter = 'all' | HistoryStatus;
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'stopped', label: 'Stopped' },
] as const;

export default function HistoryScreen() {
  const { records, loaded, clear } = useHistory();
  const [filter, setFilter] = useState<Filter>('all');

  const visible = records.filter((r) => matchesFilter(r, filter === 'all' ? {} : { status: filter }));
  const summary = summarize(visible);

  const confirmClear = () =>
    Alert.alert('Clear history?', 'All saved executions will be deleted from this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void clear() },
    ]);

  return (
    <Screen
      title="History"
      subtitle={loaded ? `${records.length} saved execution${records.length === 1 ? '' : 's'}` : 'Loading…'}
      action={
        <Button title="Clear" icon="trash" variant="secondary" disabled={records.length === 0} onPress={confirmClear} />
      }>
      <View style={styles.grid}>
        <Stat label="Executions" value={String(summary.totalExecutions)} />
        <Stat label="Avg duration" value={summary.totalExecutions ? formatDuration(summary.averageDurationMs) : '–'} />
        <Stat label="Clicks OK" value={String(summary.successfulClicks)} />
        <Stat label="Clicks failed" value={String(summary.failedClicks)} danger={summary.failedClicks > 0} />
      </View>

      <SegmentedControl options={FILTERS} value={filter} onChange={setFilter} />

      {visible.length === 0 ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            {records.length === 0
              ? 'Nothing recorded yet. Run the timer on the Home tab to see an entry here.'
              : 'No executions match this filter.'}
          </ThemedText>
        </Card>
      ) : (
        <Card style={styles.list}>
          {visible.map((record, i) => (
            <Row key={record.id} record={record} first={i === 0} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  const theme = useTheme();
  return (
    <Card style={styles.stat}>
      <ThemedText type="subtitle" style={[styles.statValue, danger && { color: theme.danger }]}>
        {value}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </Card>
  );
}

function Row({ record, first }: { record: HistoryRecord; first: boolean }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const ok = record.status === 'success';
  const color = ok ? theme.success : record.status === 'failed' ? theme.danger : theme.textSecondary;
  const { total, succeeded, failed } = record.clicks;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => record.error && setOpen((v) => !v)}
      style={[styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }]}>
      <View style={styles.rowHead}>
        <Icon name={ok ? 'check' : record.status === 'failed' ? 'error' : 'stop'} color={color} size={22} />
        <View style={styles.flex}>
          <ThemedText type="default" style={styles.bold}>
            {record.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {new Date(record.startedAt).toLocaleString()} · {formatDuration(record.durationMs)}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {total} click{total === 1 ? '' : 's'} · {succeeded} ok · {failed} failed
          </ThemedText>
        </View>
      </View>
      {record.error && (
        <View style={[styles.error, { backgroundColor: theme.dangerSoft }]}>
          <ThemedText type="small" style={{ color: theme.danger }}>
            {record.error.code ? `${record.error.code}: ` : ''}
            {record.error.message}
          </ThemedText>
          {open && record.error.details && (
            <ThemedText type="small" themeColor="textSecondary">
              {record.error.details}
            </ThemedText>
          )}
          {record.error.details && !open && (
            <ThemedText type="small" themeColor="textSecondary">
              Tap for details
            </ThemedText>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: { flexBasis: '47%', flexGrow: 1, padding: 14, gap: 4 },
  statValue: { fontSize: 24, lineHeight: 30 },
  list: { gap: 0, paddingVertical: 4 },
  row: { paddingVertical: 14, gap: 8 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  error: { borderRadius: 12, padding: 10, gap: 4 },
  empty: { textAlign: 'center', paddingVertical: 16 },
});
