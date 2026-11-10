import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTheme } from '@/hooks/use-theme';
import {
  MlKitTextRecognizer,
  OcrService,
  OcrUnavailableError,
  type OcrSearchConfig,
  type ScanResult,
  type TextMatch,
} from '@/ocr';

const service = new OcrService(new MlKitTextRecognizer());

type State =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'done'; result: ScanResult }
  | { kind: 'error'; message: string };

function describe(m: TextMatch): string {
  if (!m.center || !m.box) return `“${m.matchedText}” (no coordinates)`;
  const { x, y } = m.center;
  return `“${m.matchedText}” at (${Math.round(x)}, ${Math.round(y)}) · ${Math.round(m.box.width)}×${Math.round(m.box.height)}`;
}

/**
 * Lets the user pick an image from their photo library and runs OCR on it.
 * The picker hands the app only the image the user chose, so no extra screen-capture or camera
 * permission is involved.
 */
export function OcrTester({ config }: { config: OcrSearchConfig }) {
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'idle' });

  const run = async (imageUri: string) => {
    setState({ kind: 'scanning' });
    try {
      setState({ kind: 'done', result: await service.scan(imageUri, config) });
    } catch (e) {
      const message =
        e instanceof OcrUnavailableError
          ? 'OCR needs a development build. It is not available in Expo Go.'
          : e instanceof Error
            ? e.message
            : String(e);
      setState({ kind: 'error', message });
    }
  };

  const pick = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled) return;
    const next = picked.assets[0].uri;
    setUri(next);
    await run(next);
  };

  const result = state.kind === 'done' ? state.result : null;
  const statusLabel = {
    success: 'Success keyword found',
    'target-found': 'Target found',
    'not-found': 'Nothing found',
  };

  return (
    <Card>
      <ThemedText type="default" style={styles.bold}>
        Test with a screenshot
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Pick an image from your photo library. Only the image you choose is read.
      </ThemedText>

      {uri && <Image source={{ uri }} contentFit="contain" style={styles.preview} />}

      <Button
        title={uri ? 'Choose another image' : 'Choose image'}
        disabled={state.kind === 'scanning'}
        onPress={pick}
      />
      {uri && state.kind !== 'scanning' && (
        <Button title="Scan again" variant="secondary" onPress={() => run(uri)} />
      )}

      {state.kind === 'scanning' && (
        <ThemedText type="small" themeColor="textSecondary">
          Recognizing text…
        </ThemedText>
      )}

      {state.kind === 'error' && (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {state.message}
        </ThemedText>
      )}

      {result && (
        <View style={styles.results}>
          <ThemedText type="smallBold" style={{ color: result.status === 'not-found' ? theme.textSecondary : theme.primary }}>
            {statusLabel[result.status]} · {result.ocr.lines.length} lines recognized
          </ThemedText>

          <ThemedText type="smallBold">Targets ({result.targets.length})</ThemedText>
          {result.targets.map((m, i) => (
            <ThemedText key={`t${i}`} type="small" themeColor="textSecondary">
              {describe(m)}
            </ThemedText>
          ))}

          <ThemedText type="smallBold">Success ({result.successes.length})</ThemedText>
          {result.successes.map((m, i) => (
            <ThemedText key={`s${i}`} type="small" themeColor="textSecondary">
              {describe(m)}
            </ThemedText>
          ))}

          <ThemedText type="smallBold">Recognized text</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {result.ocr.text || '(empty)'}
          </ThemedText>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '700' },
  preview: { width: '100%', height: 200, borderRadius: 12 },
  results: { gap: 6 },
});
