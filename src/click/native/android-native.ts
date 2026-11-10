import { requireOptionalNativeModule } from 'expo';

import type { FlyClickNativeModule } from '../adapters/android-accessibility-adapter';

/**
 * Looks up the Kotlin module from modules/fly-click-accessibility.
 * Returns null where it is not linked (Expo Go, iOS, web), so callers can degrade gracefully.
 */
export function loadAndroidNativeModule(): FlyClickNativeModule | null {
  return requireOptionalNativeModule<FlyClickNativeModule>('FlyClickAccessibility');
}
