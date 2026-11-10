import { useState } from 'react';

import { KeywordList } from '@/components/keyword-list';
import { OcrTester } from '@/components/ocr-tester';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { useSettings } from '@/providers/app-providers';
import type { OcrSearchConfig } from '@/ocr';
import { OCR_SENSITIVITY_HELP, toMatchOptions } from '@/settings';

export default function TextScreen() {
  const { settings } = useSettings();
  const [targetKeywords, setTargetKeywords] = useState(['Đăng ký']);
  const [successKeywords, setSuccessKeywords] = useState(['Đã đăng ký']);

  const config: OcrSearchConfig = { targetKeywords, successKeywords, ...toMatchOptions(settings.ocrSensitivity) };

  return (
    <Screen title="Text detection" subtitle="Find buttons by the text on screen">
      <KeywordList
        title="Target keywords"
        description="Text of the button to find. Case-insensitive."
        keywords={targetKeywords}
        onChange={setTargetKeywords}
        placeholder="e.g. Đăng ký"
      />
      <KeywordList
        title="Success keywords"
        description="Text that means the action worked."
        keywords={successKeywords}
        onChange={setSuccessKeywords}
        placeholder="e.g. Đã đăng ký"
      />
      <Card>
        <ThemedText type="default" style={{ fontWeight: '700' }}>
          Matching: {settings.ocrSensitivity}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {OCR_SENSITIVITY_HELP[settings.ocrSensitivity]} Change it in Settings.
        </ThemedText>
      </Card>
      <OcrTester config={config} />
    </Screen>
  );
}
