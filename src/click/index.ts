export { AndroidAccessibilityClickAdapter, type FlyClickNativeModule } from './adapters/android-accessibility-adapter';
export { InAppClickAdapter, InAppTapRegistry, type InAppTarget } from './adapters/in-app-adapter';
export { UnsupportedClickAdapter } from './adapters/unsupported-adapter';
export { ClickEngine, DEFAULT_CLICK_CONFIG } from './click-engine';
export { createClickAdapter, type AdapterDeps } from './create-adapter';
export { ClickError, toClickError, type ClickErrorCode } from './errors';
// `loadAndroidNativeModule` lives in ./native/android-native and is imported directly by app
// code, so this barrel (and its tests) never pull in `expo`.
export type {
  AdapterContext,
  ClickAdapter,
  ClickAvailability,
  ClickCapabilities,
  ClickEngineConfig,
  ClickOptions,
  ClickRequest,
  ClickResult,
  ClickVerifier,
  CoordinateSpace,
  Rect,
  TapRequest,
  VerifyContext,
} from './types';
