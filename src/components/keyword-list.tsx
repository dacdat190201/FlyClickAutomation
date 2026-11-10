import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { useTheme } from '@/hooks/use-theme';
import { cleanKeywords } from '@/ocr';

type KeywordListProps = {
  title: string;
  description: string;
  keywords: string[];
  onChange: (keywords: string[]) => void;
  placeholder?: string;
};

/** Editable list of keywords shown as removable chips. */
export function KeywordList({ title, description, keywords, onChange, placeholder }: KeywordListProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState('');

  const add = () => {
    onChange(cleanKeywords([...keywords, draft]));
    setDraft('');
  };

  return (
    <Card>
      <View>
        <ThemedText type="default" style={styles.bold}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {description}
        </ThemedText>
      </View>

      <View style={styles.chips}>
        {keywords.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            Chưa có từ khóa.
          </ThemedText>
        )}
        {keywords.map((k) => (
          <Pressable
            key={k}
            accessibilityLabel={`Xóa ${k}`}
            onPress={() => onChange(keywords.filter((x) => x !== k))}
            style={[styles.chip, { backgroundColor: theme.primarySoft }]}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              {k}
            </ThemedText>
            <Icon name="close" color={theme.primary} size={12} />
          </Pressable>
        ))}
      </View>

      <TextField
        label="Thêm từ khóa"
        placeholder={placeholder}
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => draft.trim() && add()}
        returnKeyType="done"
      />
      <Button title="Thêm" icon="add" variant="secondary" disabled={!draft.trim()} onPress={add} />
    </Card>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
});
