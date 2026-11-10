import { useState } from 'react';

import { KeywordList } from '@/components/keyword-list';
import { OcrTester } from '@/components/ocr-tester';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { SwitchRow } from '@/components/ui/switch-row';
import type { OcrSearchConfig } from '@/ocr';

export default function TextScreen() {
  const [targetKeywords, setTargetKeywords] = useState(['Đăng ký']);
  const [successKeywords, setSuccessKeywords] = useState(['Đã đăng ký']);
  const [ignoreDiacritics, setIgnoreDiacritics] = useState(true);

  const config: OcrSearchConfig = { targetKeywords, successKeywords, ignoreDiacritics };

  return (
    <Screen title="Text detection" subtitle="Find buttons by the text on screen">
      <KeywordList
        title="Target keywords"
        description="Text of the button to find. Case-insensitive, partial matches count."
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
        <SwitchRow
          label="Ignore diacritics"
          description='Match "dang ky" with "đăng ký". Helps when OCR drops accents.'
          value={ignoreDiacritics}
          onValueChange={setIgnoreDiacritics}
        />
      </Card>
      <OcrTester config={config} />
    </Screen>
  );
}
