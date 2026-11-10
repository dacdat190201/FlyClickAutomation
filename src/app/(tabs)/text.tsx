import { useState } from 'react';

import { KeywordList } from '@/components/keyword-list';
import { OcrTester } from '@/components/ocr-tester';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { ThemedText } from '@/components/themed-text';
import { useSettings } from '@/providers/app-providers';
import type { OcrSearchConfig } from '@/ocr';
import { OCR_SENSITIVITY_HELP, OCR_SENSITIVITY_LABEL, toMatchOptions } from '@/settings';

export default function TextScreen() {
  const { settings } = useSettings();
  const [targetKeywords, setTargetKeywords] = useState(['Đăng ký']);
  const [successKeywords, setSuccessKeywords] = useState(['Đã đăng ký']);

  const config: OcrSearchConfig = { targetKeywords, successKeywords, ...toMatchOptions(settings.ocrSensitivity) };

  return (
    <Screen title="Nhận diện văn bản" subtitle="Tìm nút theo chữ trên màn hình">
      <KeywordList
        title="Từ khóa mục tiêu"
        description="Chữ trên nút cần tìm. Không phân biệt hoa/thường."
        keywords={targetKeywords}
        onChange={setTargetKeywords}
        placeholder="VD: Đăng ký"
      />
      <KeywordList
        title="Từ khóa thành công"
        description="Chữ cho biết thao tác đã thành công."
        keywords={successKeywords}
        onChange={setSuccessKeywords}
        placeholder="VD: Đã đăng ký"
      />
      <Card>
        <ThemedText type="default" style={{ fontWeight: '700' }}>
          Độ nhạy khớp: {OCR_SENSITIVITY_LABEL[settings.ocrSensitivity]}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {OCR_SENSITIVITY_HELP[settings.ocrSensitivity]} Đổi trong Cài đặt.
        </ThemedText>
      </Card>
      <OcrTester config={config} />
    </Screen>
  );
}
