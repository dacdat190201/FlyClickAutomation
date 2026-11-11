import { useCallback, useEffect, useRef } from 'react';

import { loadAndroidNativeModule } from '@/click/native/android-native';

type Options = {
  /** Whether automation is currently running (drives the play/pause icon). */
  running: boolean;
  onToggle: () => void;
  /** The "choose points" button on the bar. */
  onPick?: () => void;
};

/**
 * Controls the floating bar that stays visible over other apps (Android only).
 * `show()` resolves false when unavailable (no native module, or accessibility service is off).
 * The bar is removed when the component unmounts.
 */
export function useFloatingControls({ running, onToggle, onPick }: Options) {
  const native = useRef(loadAndroidNativeModule()).current;
  const toggleRef = useRef(onToggle);
  toggleRef.current = onToggle;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const visible = useRef(false);

  const hide = useCallback(() => {
    visible.current = false;
    native?.hideFloatingControls();
  }, [native]);

  useEffect(() => {
    if (!native) return;
    const sub = native.addListener('onFloatingAction', ({ action }) => {
      if (action === 'toggle') toggleRef.current();
      else if (action === 'pick') pickRef.current?.();
      else hide();
    });
    return () => {
      sub.remove();
      native.hideFloatingControls();
    };
  }, [native, hide]);

  useEffect(() => {
    if (visible.current) native?.setFloatingPlaying(running);
  }, [native, running]);

  const show = useCallback(async () => {
    if (!native) return false;
    const ok = await native.showFloatingControls(running);
    visible.current = ok;
    return ok;
  }, [native, running]);

  return { show, hide, available: native !== null };
}
