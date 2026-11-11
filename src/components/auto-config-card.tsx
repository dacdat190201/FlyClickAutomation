import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { parseList, speedOf, SPEED_PRESETS, type AutoConfig, type Mode, type RunProgress, type RunResult, type Speed } from '@/auto';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SwitchRow } from '@/components/ui/switch-row';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';

const RESULT_LABEL: Record<RunResult['status'], string> = {
  completed: 'Hoàn tất',
  partial: 'Xong một phần',
  stopped: 'Đã dừng',
  timeout: 'Quá thời gian',
  failed: 'Lỗi',
};

const SPEEDS = [
  { value: 'fast', label: 'Nhanh' },
  { value: 'normal', label: 'Vừa' },
  { value: 'safe', label: 'Chậm' },
] as const;

const MODES = [
  { value: 'register', label: 'Tìm chữ & đăng ký' },
  { value: 'points', label: 'Click theo điểm' },
] as const;

const digits = (v: string) => v.replace(/\D/g, '');

const TAB_ICON = { pending: '○', running: '▶', done: '✓', failed: '✗', 'not-reached': '–' } as const;

type Props = {
  config: AutoConfig;
  onChange: (next: AutoConfig) => void;
  running: boolean;
  progress: RunProgress | null;
  result: RunResult | null;
  /** The crosshair picker is open over the other app. */
  pickerOpen: boolean;
  onTogglePicker: () => void;
};

/** Edits the tabs and keywords, and shows what the automation is doing. */
export function AutoConfigCard({ config, onChange, running, progress, result, pickerOpen, onTogglePicker }: Props) {
  const theme = useTheme();
  // Text is kept as typed and parsed on every change, so commas and spaces can be typed freely.
  // The parent remounts this card (via `key`) once the saved config has loaded.
  const [tabs, setTabs] = useState(config.tabs.join(', '));
  const [target, setTarget] = useState(config.targetKeywords.join(', '));
  const [success, setSuccess] = useState(config.successKeywords.join(', '));
  const commit = (t: string, k: string, s: string) => {
    const tabsList = parseList(t);
    const targets = parseList(k);
    const successes = parseList(s);
    if (tabsList.length && targets.length && successes.length) {
      onChange({ ...config, tabs: tabsList, targetKeywords: targets, successKeywords: successes });
    }
  };

  const [interval, setIntervalText] = useState(String(config.pointIntervalMs));
  const [rounds, setRounds] = useState(config.pointRounds === 0 ? '' : String(config.pointRounds));

  const shown = progress?.tabs ?? result?.tabs ?? [];

  return (
    <Card>
      <SegmentedControl<Mode>
        options={MODES}
        value={config.mode}
        onChange={(v) => !running && onChange({ ...config, mode: v })}
      />
      <ThemedText type="default" style={styles.bold}>
        {config.mode === 'points' ? 'Click theo điểm' : 'Đăng ký tự động'}
      </ThemedText>
      {config.mode === 'register' && (
        <ThemedText type="small" themeColor="textSecondary">
          Mở app cần đăng ký (đang ở tab đầu), rồi bấm Bắt đầu trên thanh nổi. App tự tìm chữ trên màn hình,
          bấm cho đến khi đổi thành chữ thành công, rồi sang tab kế.
        </ThemedText>
      )}

      {config.mode === 'points' ? (
        <>
          <ThemedText type="small" themeColor="textSecondary">
            Bấm “Chọn điểm” (hoặc nút ◎ trên thanh nổi), kéo dấu + tới chỗ cần click rồi bấm “Lưu”. Lặp lại cho các
            điểm khác, bấm Xong. Khi chạy, app bấm lần lượt các điểm.
          </ThemedText>
          <View style={styles.row}>
            <Button
              title={pickerOpen ? 'Đóng bộ chọn' : 'Chọn điểm'}
              icon={pickerOpen ? 'close' : 'target'}
              variant={pickerOpen ? 'secondary' : 'primary'}
              disabled={running}
              onPress={onTogglePicker}
              style={styles.flex}
            />
            <Button
              title="Xóa hết"
              icon="trash"
              variant="secondary"
              disabled={running || config.points.length === 0}
              onPress={() => onChange({ ...config, points: [] })}
              style={styles.flex}
            />
          </View>

          {config.points.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Chưa có điểm nào.
            </ThemedText>
          ) : (
            config.points.map((pt, i) => (
              <View key={`${i}-${pt.x}-${pt.y}`} style={styles.pointRow}>
                <ThemedText type="default" style={styles.flex}>
                  {i + 1}. ({pt.x}, {pt.y})
                </ThemedText>
                <Pressable
                  accessibilityLabel={`Xóa điểm ${i + 1}`}
                  hitSlop={8}
                  disabled={running}
                  onPress={() => onChange({ ...config, points: config.points.filter((_, j) => j !== i) })}>
                  <ThemedText style={{ color: theme.danger }}>Xóa</ThemedText>
                </Pressable>
              </View>
            ))
          )}

          <View style={styles.row}>
            <View style={styles.flex}>
              <TextField
                label="Nghỉ sau mỗi điểm (ms)"
                keyboardType="number-pad"
                value={interval}
                editable={!running}
                onChangeText={(v) => {
                  setIntervalText(digits(v));
                  onChange({ ...config, pointIntervalMs: Number(digits(v) || 0) });
                }}
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label="Số vòng"
                placeholder="∞ đến khi dừng"
                keyboardType="number-pad"
                value={rounds}
                editable={!running}
                onChangeText={(v) => {
                  setRounds(digits(v));
                  onChange({ ...config, pointRounds: Number(digits(v) || 0) });
                }}
              />
            </View>
          </View>
        </>
      ) : (
        <>

      <TextField
        label="Các tab, theo thứ tự (cách nhau bằng dấu phẩy)"
        value={tabs}
        editable={!running}
        onChangeText={(v) => {
          setTabs(v);
          commit(v, target, success);
        }}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            label="Chữ trên nút cần bấm"
            value={target}
            editable={!running}
            onChangeText={(v) => {
              setTarget(v);
              commit(tabs, v, success);
            }}
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label="Chữ khi đã xong"
            value={success}
            editable={!running}
            onChangeText={(v) => {
              setSuccess(v);
              commit(tabs, target, v);
            }}
          />
        </View>
      </View>

        </>
      )}

      {config.mode === 'register' && (
        <>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Tốc độ click
          </ThemedText>
          <SegmentedControl<Speed>
            options={SPEEDS}
            value={speedOf(config) ?? 'fast'}
            onChange={(v) => !running && onChange({ ...config, ...SPEED_PRESETS[v] })}
          />
        </>
      )}
      <SwitchRow
        label="Hiện điểm chạm"
        description="Vòng đỏ kèm số thứ tự lần click hiện ngay tại chỗ được bấm."
        value={config.showMarkers}
        onValueChange={(v) => onChange({ ...config, showMarkers: v })}
      />

      {(running || result) && (
        <View style={[styles.status, { backgroundColor: theme.primarySoft }]}>
          <ThemedText type="smallBold" style={{ color: theme.primary }}>
            {running ? (progress?.message ?? 'Đang khởi động…') : RESULT_LABEL[result!.status]}
            {!running && result?.reason && result.status !== 'completed' ? ` · ${result.reason}` : ''}
          </ThemedText>
          {shown.map((t) => (
            <ThemedText key={t.name} type="small" themeColor="textSecondary">
              {TAB_ICON[t.status]} {t.name} · đã đăng ký {t.registered}
              {t.failed ? ` · lỗi ${t.failed}` : ''}
            </ThemedText>
          ))}
          <ThemedText type="subtitle" style={{ color: theme.primary }}>
            {progress?.clicks ?? result?.clicks ?? 0} lần bấm
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {config.mode === 'register' ? `Đã đăng ký ${shown.reduce((n, t) => n + t.registered, 0)} · ` : ''}
            số này cũng hiện trên thanh nổi
          </ThemedText>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12 },
  status: { borderRadius: 16, padding: 14, gap: 4 },
  pointRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
