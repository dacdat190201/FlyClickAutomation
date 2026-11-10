import { AndroidAccessibilityClickAdapter, type FlyClickNativeModule } from './adapters/android-accessibility-adapter';
import { InAppClickAdapter, type InAppTapRegistry } from './adapters/in-app-adapter';
import { UnsupportedClickAdapter } from './adapters/unsupported-adapter';
import type { ClickAdapter } from './types';

export type AdapterDeps = {
  /** Android only: the native module, or null if not in the build. */
  androidNative?: FlyClickNativeModule | null;
  /** iOS only: registry of the app's own tappable controls. */
  registry?: InAppTapRegistry;
};

/** Picks the adapter for a platform (`Platform.OS`). Dependencies are injected for testability. */
export function createClickAdapter(platform: string, deps: AdapterDeps = {}): ClickAdapter {
  switch (platform) {
    case 'android':
      return new AndroidAccessibilityClickAdapter(deps.androidNative ?? null);
    case 'ios':
      if (!deps.registry) throw new Error('createClickAdapter("ios") requires a registry');
      return new InAppClickAdapter(deps.registry);
    default:
      return new UnsupportedClickAdapter();
  }
}
