import { ClickError } from '../errors';
import type {
  AdapterContext,
  ClickAdapter,
  ClickAvailability,
  ClickCapabilities,
  TapRequest,
} from '../types';

export type ScreenNode = { text: string; x: number; y: number; w: number; h: number; clickable: boolean };
export type ScreenSnapshot = { pkg: string; self: string; nodes: ScreenNode[] };

/**
 * Contract of the Kotlin module in modules/fly-click-accessibility
 * (`requireOptionalNativeModule('FlyClickAccessibility')`).
 */
export interface FlyClickNativeModule {
  /** True while the user has enabled the accessibility service and it is connected. */
  isServiceEnabled(): boolean;
  /** Opens Android's Accessibility settings so the user can enable the service. */
  openAccessibilitySettings(): void;
  /**
   * Dispatches a tap at screen pixel (x, y).
   * Resolves `true` when the gesture completed, `false` when Android cancelled it.
   * Rejects with a `code` of ERR_SERVICE_NOT_CONNECTED, ERR_BUSY, ERR_OUT_OF_BOUNDS,
   * ERR_INVALID_DURATION or ERR_DISPATCH_REJECTED.
   */
  tap(x: number, y: number, durationMs: number): Promise<boolean>;
  /**
   * Text nodes of the window in front (screen pixels), or null when no window is available.
   * `self` is this app's package name, so callers can refuse to act on their own screen.
   */
  snapshot(): ScreenSnapshot | null;
  /** Dispatches a straight swipe between two screen pixels. Same error codes as `tap`. */
  swipe(x1: number, y1: number, x2: number, y2: number, durationMs: number): Promise<boolean>;
  /** Shows the draggable control bar over other apps. Resolves false if the service is off. */
  showFloatingControls(playing: boolean): Promise<boolean>;
  /** Switches the bar's main button between play and pause. */
  setFloatingPlaying(playing: boolean): void;
  hideFloatingControls(): void;
  /** Short text above the bar's buttons (e.g. the click count). */
  setFloatingStatus(text: string): void;
  /** Flashes a ring with `label` at screen pixel (x, y) so taps are visible. Not touchable. */
  showTapMarker(x: number, y: number, label: string): void;
  /** Shows the crosshair picker (drag it, press "Lưu" to save a point). Resolves false if the service is off. */
  showPointPicker(): Promise<boolean>;
  hidePointPicker(): void;
  /** Numbered dots for saved points, flat `[x1, y1, x2, y2, ...]` in screen pixels. */
  setPointDots(flat: number[]): void;
  /** `onFloatingAction` fires with `{ action }` when a bar button is pressed. */
  addListener(
    event: 'onFloatingAction',
    listener: (e: { action: 'toggle' | 'pick' | 'close' }) => void,
  ): { remove(): void };
  /** `onPointPicker` fires on "Lưu" (`save`, with the crosshair centre) and "Xong" (`done`). */
  addListener(
    event: 'onPointPicker',
    listener: (e: { action: 'save' | 'done'; x: number; y: number }) => void,
  ): { remove(): void };
}

function errorCode(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  // Fall back to the message in case the bridge dropped the code.
  const message = e instanceof Error ? e.message : String(e);
  return /ERR_[A-Z_]+/.exec(message)?.[0] ?? '';
}

/**
 * Android adapter: taps anywhere on screen through an AccessibilityService gesture.
 * Subject to the user enabling the service in Settings and to Google Play policy (see
 * docs/click-engine.md). Coordinates are physical screen pixels.
 */
export class AndroidAccessibilityClickAdapter implements ClickAdapter {
  readonly platform = 'android' as const;
  readonly capabilities: ClickCapabilities = {
    crossApp: true,
    supportsDuration: true,
    coordinateSpace: 'screen-pixels',
    description:
      'Taps via an Android AccessibilityService. Requires the user to enable the service in Settings.',
  };

  private readonly native: FlyClickNativeModule | null;

  /** Pass `null` when the native module is not part of the build (Expo Go, web, iOS). */
  constructor(native: FlyClickNativeModule | null) {
    this.native = native;
  }

  async getAvailability(): Promise<ClickAvailability> {
    if (!this.native) {
      return {
        available: false,
        reason: 'The Android click module is not in this build. Use a development build.',
      };
    }
    if (!this.native.isServiceEnabled()) {
      return {
        available: false,
        reason: 'The accessibility service is not enabled. Turn it on in Android Settings → Accessibility.',
        action: 'enable-accessibility-service',
      };
    }
    return { available: true };
  }

  /** Sends the user to Android's Accessibility settings. No-op without the native module. */
  openAccessibilitySettings(): void {
    this.native?.openAccessibilitySettings();
  }

  async tap({ x, y, durationMs }: TapRequest, { signal }: AdapterContext): Promise<void> {
    if (!this.native) throw new ClickError('UNAVAILABLE', 'The Android click module is not in this build.');
    if (signal.aborted) throw new ClickError('CANCELLED', 'Click was cancelled');

    let completed: boolean;
    try {
      completed = await this.native.tap(x, y, durationMs);
    } catch (e) {
      switch (errorCode(e)) {
        case 'ERR_SERVICE_NOT_CONNECTED':
          throw new ClickError('UNAVAILABLE', 'The accessibility service is not connected.', { cause: e });
        case 'ERR_BUSY':
        case 'ERR_DISPATCH_REJECTED':
          // Android refused to start the gesture, so nothing was tapped: safe to retry.
          throw new ClickError('REJECTED', 'Android did not accept the gesture.', { retryable: true, cause: e });
        case 'ERR_OUT_OF_BOUNDS':
        case 'ERR_INVALID_DURATION':
          throw new ClickError('INVALID_REQUEST', e instanceof Error ? e.message : 'Invalid tap', { cause: e });
        default:
          throw new ClickError('ADAPTER_ERROR', e instanceof Error ? e.message : String(e), { cause: e });
      }
    }

    if (!completed) {
      // onCancelled: Android interrupted the gesture (e.g. another gesture or the screen changed).
      throw new ClickError('REJECTED', 'Android cancelled the gesture before it finished.', {
        retryable: true,
      });
    }
  }
}
