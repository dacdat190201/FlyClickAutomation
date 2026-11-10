import Constants from 'expo-constants';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SwitchRow } from '@/components/ui/switch-row';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { useSettings } from '@/providers/app-providers';
import {
  OCR_SENSITIVITY_HELP,
  SettingsError,
  checkSetting,
  type OcrSensitivity,
  type Settings,
  type ThemePreference,
} from '@/settings';

const SENSITIVITIES: { value: OcrSensitivity; label: string }[] = [
  { value: 'strict', label: 'Strict' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'lenient', label: 'Lenient' },
];
const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const theme = useTheme();
  const { settings, update, reset } = useSettings();
  const [error, setError] = useState<string | null>(null);

  /** Saves a change and shows why it was refused, if it was. */
  const save = async (patch: Partial<Settings>) => {
    try {
      await update(patch);
      setError(null);
    } catch (e) {
      setError(e instanceof SettingsError ? e.problems.join('. ') : 'Could not save settings');
    }
  };

  return (
    <Screen title="Settings" subtitle="Saved automatically on this device">
      <Card>
        <ThemedText type="default" style={styles.bold}>
          Clicking
        </ThemedText>
        <View style={styles.row}>
          <View style={styles.flex}>
            <NumberField
              label="Click interval (ms)"
              value={settings.clickIntervalMs}
              settingKey="clickIntervalMs"
              onCommit={(n) => save({ clickIntervalMs: n })}
              onInvalid={setError}
            />
          </View>
          <View style={styles.flex}>
            <NumberField
              label="Retry count"
              value={settings.retryCount}
              settingKey="retryCount"
              onCommit={(n) => save({ retryCount: n })}
              onInvalid={setError}
            />
          </View>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Defaults for new clicks and automations: the minimum gap between clicks, and how many times a failed click is retried.
        </ThemedText>
      </Card>

      <Card>
        <ThemedText type="default" style={styles.bold}>
          OCR matching sensitivity
        </ThemedText>
        <SegmentedControl options={SENSITIVITIES} value={settings.ocrSensitivity} onChange={(v) => save({ ocrSensitivity: v })} />
        <ThemedText type="small" themeColor="textSecondary">
          {OCR_SENSITIVITY_HELP[settings.ocrSensitivity]}
        </ThemedText>
      </Card>

      <Card>
        <ThemedText type="default" style={styles.bold}>
          Appearance and feedback
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Theme
        </ThemedText>
        <SegmentedControl options={THEME_OPTIONS} value={settings.theme} onChange={(v) => save({ theme: v })} />
        <SwitchRow
          label="Haptic feedback"
          description="A small vibration when you press buttons and change options"
          value={settings.hapticFeedback}
          onValueChange={(v) => save({ hapticFeedback: v })}
        />
      </Card>

      {error && (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      )}

      <Button
        title="Reset to defaults"
        variant="secondary"
        onPress={() => {
          setError(null);
          void reset();
        }}
      />

      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        FlyClickAutomation v{Constants.expoConfig?.version ?? '1.0.0'}
      </ThemedText>
    </Screen>
  );
}

/** Number input that commits on blur and refuses values outside the allowed range. */
function NumberField({
  label,
  value,
  settingKey,
  onCommit,
  onInvalid,
}: {
  label: string;
  value: number;
  settingKey: 'clickIntervalMs' | 'retryCount';
  onCommit: (n: number) => void;
  onInvalid: (message: string) => void;
}) {
  // `draft` is only set while the user is typing; otherwise the saved value is shown.
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    const problem = draft === '' ? 'Enter a number' : checkSetting(settingKey, n);
    if (problem) onInvalid(problem);
    else if (n !== value) onCommit(n);
    setDraft(null); // always fall back to the saved value
  };

  return (
    <TextField
      label={label}
      keyboardType="number-pad"
      value={draft ?? String(value)}
      onChangeText={(v) => setDraft(v.replace(/\D/g, ''))}
      onEndEditing={commit}
      onSubmitEditing={commit}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12 },
});
