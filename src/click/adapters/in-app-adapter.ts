import { ClickError } from '../errors';
import type {
  AdapterContext,
  ClickAdapter,
  ClickAvailability,
  ClickCapabilities,
  Rect,
  TapRequest,
} from '../types';

/** A control inside THIS app that can be "pressed" programmatically. */
export type InAppTarget = {
  id: string;
  /** Current bounds in window coordinates, or null if not laid out / not visible. */
  getBounds(): Rect | null;
  /** The same handler the control runs when the user taps it. */
  onPress(): void | Promise<void>;
  /** Return false to make the control temporarily untappable (e.g. disabled). */
  isEnabled?(): boolean;
  /** Higher wins when targets overlap. Defaults to registration order (later = on top). */
  zIndex?: number;
};

/** Registry of the app's own tappable controls, used for hit-testing coordinates. */
export class InAppTapRegistry {
  private readonly targets = new Map<string, InAppTarget>();

  /** Returns an unregister function (call it from an effect cleanup). */
  register(target: InAppTarget): () => void {
    this.targets.set(target.id, target);
    return () => {
      if (this.targets.get(target.id) === target) this.targets.delete(target.id);
    };
  }

  get size(): number {
    return this.targets.size;
  }

  /** Topmost enabled target whose bounds contain (x, y). */
  hitTest(x: number, y: number): InAppTarget | null {
    let best: InAppTarget | null = null;
    let bestKey = -Infinity;
    let order = 0;
    for (const target of this.targets.values()) {
      order++;
      if (target.isEnabled && !target.isEnabled()) continue;
      const b = target.getBounds();
      if (!b || x < b.left || x > b.left + b.width || y < b.top || y > b.top + b.height) continue;
      const key = (target.zIndex ?? 0) * 1_000_000 + order;
      if (key > bestKey) {
        best = target;
        bestKey = key;
      }
    }
    return best;
  }
}

/**
 * iOS adapter. iOS gives apps NO public API to tap in other apps or system UI, so this adapter
 * only does what is supported: it finds one of this app's own registered controls at the
 * requested window coordinates and calls its `onPress`. It does not synthesize touch events
 * and cannot act outside the app. See docs/click-engine.md.
 */
export class InAppClickAdapter implements ClickAdapter {
  readonly platform = 'ios-in-app' as const;
  readonly capabilities: ClickCapabilities = {
    crossApp: false,
    supportsDuration: false,
    coordinateSpace: 'window-points',
    description:
      "Presses this app's own registered controls only. No cross-app taps (not possible on iOS). Tap duration is ignored.",
  };

  private readonly registry: InAppTapRegistry;

  constructor(registry: InAppTapRegistry) {
    this.registry = registry;
  }

  async getAvailability(): Promise<ClickAvailability> {
    return { available: true };
  }

  async tap({ x, y }: TapRequest, { signal }: AdapterContext): Promise<void> {
    if (signal.aborted) throw new ClickError('CANCELLED', 'Click was cancelled');

    const target = this.registry.hitTest(x, y);
    if (!target) {
      throw new ClickError(
        'NO_TARGET',
        `No tappable control of this app at (${x}, ${y}). iOS does not allow tapping other apps.`,
      );
    }
    try {
      await target.onPress();
    } catch (e) {
      // The handler ran (at least partly), so the outcome is unknown: not retryable.
      throw new ClickError('ADAPTER_ERROR', `onPress of "${target.id}" failed`, { cause: e });
    }
  }
}
