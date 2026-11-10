import { useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Screen } from '@/components/ui/screen';
import { SwitchRow } from '@/components/ui/switch-row';
import { TextField } from '@/components/ui/text-field';
import { MOCK_RULES, type TextRule } from '@/data/mock';
import { useTheme } from '@/hooks/use-theme';

export default function TextScreen() {
  const theme = useTheme();
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState<TextRule[]>(MOCK_RULES);
  const [keyword, setKeyword] = useState('');

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      { id: `r${Date.now()}`, keyword: keyword.trim(), action: 'Tap match', enabled: true },
    ]);
    setKeyword('');
  };

  const toggle = (id: string, value: boolean) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: value } : r)));

  return (
    <Screen title="Text detection" subtitle="Click when a word appears on screen">
      <Card>
        <SwitchRow
          label="Enable text detection"
          description="Demo only, OCR is not implemented yet"
          value={enabled}
          onValueChange={setEnabled}
        />
      </Card>

      <Card>
        <ThemedText type="default" style={styles.bold}>
          Scan area
        </ThemedText>
        <View style={[styles.preview, { borderColor: theme.primary, backgroundColor: theme.primarySoft }]}>
          <Icon name="text" color={theme.primary} size={36} />
          <ThemedText type="small" themeColor="textSecondary">
            Preview placeholder · 1080 × 400
          </ThemedText>
        </View>
      </Card>

      <Card>
        <ThemedText type="default" style={styles.bold}>
          Keyword rules
        </ThemedText>
        {rules.map((r) => (
          <View key={r.id} style={styles.ruleRow}>
            <View style={styles.flex}>
              <ThemedText type="default">“{r.keyword}”</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {r.action}
              </ThemedText>
            </View>
            <Switch
              value={r.enabled}
              onValueChange={(v) => toggle(r.id, v)}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor="#ffffff"
              ios_backgroundColor={theme.border}
            />
          </View>
        ))}
        <TextField
          label="New keyword"
          placeholder="e.g. Confirm"
          value={keyword}
          onChangeText={setKeyword}
          onSubmitEditing={() => keyword.trim() && addRule()}
          returnKeyType="done"
        />
        <Button title="Add rule" icon="add" disabled={!keyword.trim()} onPress={addRule} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontWeight: '700' },
  preview: {
    height: 120,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
