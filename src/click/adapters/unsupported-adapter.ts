import { ClickError } from '../errors';
import type { ClickAdapter, ClickAvailability, ClickCapabilities } from '../types';

/** Used on platforms with no click support (e.g. web). It never pretends to click. */
export class UnsupportedClickAdapter implements ClickAdapter {
  readonly platform = 'unsupported' as const;
  readonly capabilities: ClickCapabilities = {
    crossApp: false,
    supportsDuration: false,
    coordinateSpace: 'window-points',
    description: 'Clicking is not supported on this platform.',
  };

  async getAvailability(): Promise<ClickAvailability> {
    return { available: false, reason: 'Clicking is not supported on this platform.' };
  }

  async tap(): Promise<void> {
    throw new ClickError('UNSUPPORTED', 'Clicking is not supported on this platform.');
  }
}
