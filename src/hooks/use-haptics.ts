import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { useMemo } from 'react';

import { useSettings } from '@/providers/app-providers';

/** Haptic feedback that respects the "Haptic feedback" setting. Failures are ignored. */
export function useHaptics() {
  const { settings } = useSettings();
  const enabled = settings.hapticFeedback;

  return useMemo(() => {
    const run = (job: () => Promise<void>) => {
      if (enabled) job().catch(() => undefined);
    };
    return {
      /** A button press. */
      light: () =>
        run(() =>
          Platform.OS === 'android'
            ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm)
            : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
        ),
      /** A choice changing (toggle, segment). */
      selection: () => run(() => Haptics.selectionAsync()),
      error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
    };
  }, [enabled]);
}
