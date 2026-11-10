import Constants from 'expo-constants';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { SwitchRow } from '@/components/ui/switch-row';
import { TextField } from '@/components/ui/text-field';

const DEFAULTS = {
  interval: '1000',
  maxClicks: '500',
  randomDelay: true,
  haptics: true,
  keepAwake: false,
  notifications: true,
};

export default function SettingsScreen() {
  const [interval, setInterval] = useState(DEFAULTS.interval);
  const [maxClicks, setMaxClicks] = useState(DEFAULTS.maxClicks);
  const [randomDelay, setRandomDelay] = useState(DEFAULTS.randomDelay);
  const [haptics, setHaptics] = useState(DEFAULTS.haptics);
  const [keepAwake, setKeepAwake] = useState(DEFAULTS.keepAwake);
  const [notifications, setNotifications] = useState(DEFAULTS.notifications);

  const reset = () => {
    setInterval(DEFAULTS.interval);
    setMaxClicks(DEFAULTS.maxClicks);
    setRandomDelay(DEFAULTS.randomDelay);
    setHaptics(DEFAULTS.haptics);
    setKeepAwake(DEFAULTS.keepAwake);
    setNotifications(DEFAULTS.notifications);
  };

  const digits = (v: string) => v.replace(/\D/g, '');

  return (
    <Screen title="Settings" subtitle="Tune how automation behaves">
      <Card>
        <ThemedText type="default" style={styles.bold}>
          Clicking
        </ThemedText>
        <View style={styles.row}>
          <View style={styles.flex}>
            <TextField
              label="Interval (ms)"
              keyboardType="number-pad"
              value={interval}
              onChangeText={(v) => setInterval(digits(v))}
            />
          </View>
          <View style={styles.flex}>
            <TextField
              label="Max clicks"
              keyboardType="number-pad"
              value={maxClicks}
              onChangeText={(v) => setMaxClicks(digits(v))}
            />
          </View>
        </View>
        <SwitchRow
          label="Random delay"
          description="Vary the interval slightly between clicks"
          value={randomDelay}
          onValueChange={setRandomDelay}
        />
      </Card>

      <Card>
        <ThemedText type="default" style={styles.bold}>
          General
        </ThemedText>
        <SwitchRow label="Haptic feedback" value={haptics} onValueChange={setHaptics} />
        <SwitchRow label="Keep screen awake" value={keepAwake} onValueChange={setKeepAwake} />
        <SwitchRow label="Notifications" value={notifications} onValueChange={setNotifications} />
      </Card>

      <Button title="Reset to defaults" variant="secondary" onPress={reset} />

      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        FlyClickAutomation v{Constants.expoConfig?.version ?? '1.0.0'}
      </ThemedText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12 },
});
