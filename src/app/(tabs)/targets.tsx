import { useState } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { TextField } from '@/components/ui/text-field';
import { MOCK_TARGETS, type Target } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';

export default function TargetsScreen() {
  const theme = useTheme();
  const [targets, setTargets] = useState<Target[]>(MOCK_TARGETS);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [x, setX] = useState('');
  const [y, setY] = useState('');

  const canSave = name.trim().length > 0 && x.length > 0 && y.length > 0;

  const save = () => {
    setTargets((prev) => [
      ...prev,
      {
        id: `t${Date.now()}`,
        name: name.trim(),
        x: Number(x),
        y: Number(y),
        intervalMs: 1000,
        enabled: true,
      },
    ]);
    setName('');
    setX('');
    setY('');
    setShowForm(false);
  };

  const toggle = (id: string, enabled: boolean) =>
    setTargets((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)));

  const remove = (id: string) => setTargets((prev) => prev.filter((t) => t.id !== id));

  return (
    <Screen
      title="Targets"
      subtitle={`${targets.length} click points`}
      action={
        <Button
          title={showForm ? 'Cancel' : 'Add'}
          icon={showForm ? 'close' : 'add'}
          variant={showForm ? 'secondary' : 'primary'}
          onPress={() => setShowForm((v) => !v)}
        />
      }>
      {showForm && (
        <Card>
          <ThemedText type="default" style={styles.bold}>
            New target
          </ThemedText>
          <TextField label="Name" placeholder="e.g. Accept button" value={name} onChangeText={setName} />
          <View style={styles.row}>
            <View style={styles.flex}>
              <TextField
                label="X"
                placeholder="540"
                keyboardType="number-pad"
                value={x}
                onChangeText={(v) => setX(v.replace(/\D/g, ''))}
              />
            </View>
            <View style={styles.flex}>
              <TextField
                label="Y"
                placeholder="1820"
                keyboardType="number-pad"
                value={y}
                onChangeText={(v) => setY(v.replace(/\D/g, ''))}
              />
            </View>
          </View>
          <Button title="Save target" disabled={!canSave} onPress={save} />
        </Card>
      )}

      {targets.length === 0 && (
        <Card>
          <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
            No targets yet. Tap Add to create one.
          </ThemedText>
        </Card>
      )}

      {targets.map((t) => (
        <Card key={t.id} style={styles.targetCard}>
          <View style={[styles.iconBox, { backgroundColor: theme.primarySoft }]}>
            <Icon name="target" color={theme.primary} size={22} />
          </View>
          <View style={styles.flex}>
            <ThemedText type="default" style={styles.bold}>
              {t.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              ({t.x}, {t.y}) · every {t.intervalMs} ms
            </ThemedText>
          </View>
          <Switch
            value={t.enabled}
            onValueChange={(v) => toggle(t.id, v)}
            trackColor={{ false: theme.border, true: theme.primary }}
            thumbColor="#ffffff"
            ios_backgroundColor={theme.border}
          />
          <Pressable
            accessibilityLabel={`Delete ${t.name}`}
            hitSlop={8}
            onPress={() => remove(t.id)}>
            <Icon name="trash" color={theme.danger} size={20} />
          </Pressable>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  center: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12 },
  targetCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  iconBox: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
