import {
  AndroidAccessibilityClickAdapter,
  ClickEngine,
  ClickError,
  createClickAdapter,
  InAppClickAdapter,
  InAppTapRegistry,
  UnsupportedClickAdapter,
  type FlyClickNativeModule,
  type InAppTarget,
} from '..';

const signal = () => new AbortController().signal;
const ctx = () => ({ signal: signal() });
const tapReq = (x: number, y: number) => ({ x, y, durationMs: 50 });

function fakeNative(overrides: Partial<FlyClickNativeModule> = {}): jest.Mocked<FlyClickNativeModule> {
  return {
    isServiceEnabled: jest.fn(() => true),
    openAccessibilitySettings: jest.fn(),
    tap: jest.fn(async () => true),
    ...overrides,
  } as jest.Mocked<FlyClickNativeModule>;
}

describe('AndroidAccessibilityClickAdapter', () => {
  it('declares real cross-app support with pixel coordinates and tap duration', () => {
    const { capabilities } = new AndroidAccessibilityClickAdapter(fakeNative());
    expect(capabilities).toMatchObject({
      crossApp: true,
      supportsDuration: true,
      coordinateSpace: 'screen-pixels',
    });
  });

  describe('availability', () => {
    it('is unavailable without the native module', async () => {
      const adapter = new AndroidAccessibilityClickAdapter(null);
      expect(await adapter.getAvailability()).toMatchObject({ available: false });
      await expect(adapter.tap(tapReq(1, 1), ctx())).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    });

    it('asks the user to enable the service when it is off', async () => {
      const adapter = new AndroidAccessibilityClickAdapter(
        fakeNative({ isServiceEnabled: jest.fn(() => false) }),
      );
      expect(await adapter.getAvailability()).toMatchObject({
        available: false,
        action: 'enable-accessibility-service',
      });
    });

    it('is available when the service is enabled', async () => {
      const adapter = new AndroidAccessibilityClickAdapter(fakeNative());
      expect(await adapter.getAvailability()).toEqual({ available: true });
    });

    it('opens the accessibility settings', () => {
      const native = fakeNative();
      new AndroidAccessibilityClickAdapter(native).openAccessibilitySettings();
      expect(native.openAccessibilitySettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('tap', () => {
    it('sends coordinates and duration to the native module', async () => {
      const native = fakeNative();
      await new AndroidAccessibilityClickAdapter(native).tap({ x: 540, y: 1820, durationMs: 80 }, ctx());
      expect(native.tap).toHaveBeenCalledWith(540, 1820, 80);
    });

    it('does not tap when already cancelled', async () => {
      const native = fakeNative();
      const controller = new AbortController();
      controller.abort();
      await expect(
        new AndroidAccessibilityClickAdapter(native).tap(tapReq(1, 1), { signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(native.tap).not.toHaveBeenCalled();
    });

    it('treats a cancelled gesture (resolved false) as a retryable rejection', async () => {
      const adapter = new AndroidAccessibilityClickAdapter(fakeNative({ tap: jest.fn(async () => false) }));
      const error = await adapter.tap(tapReq(1, 1), ctx()).catch((e) => e);
      expect(error).toMatchObject({ code: 'REJECTED', retryable: true });
    });

    it.each([
      ['ERR_SERVICE_NOT_CONNECTED', 'UNAVAILABLE', false],
      ['ERR_BUSY', 'REJECTED', true],
      ['ERR_DISPATCH_REJECTED', 'REJECTED', true],
      ['ERR_OUT_OF_BOUNDS', 'INVALID_REQUEST', false],
      ['ERR_INVALID_DURATION', 'INVALID_REQUEST', false],
      ['ERR_SOMETHING_ELSE', 'ADAPTER_ERROR', false],
    ])('maps native %s to %s (retryable: %s)', async (nativeCode, code, retryable) => {
      const failure = Object.assign(new Error('native says no'), { code: nativeCode });
      const adapter = new AndroidAccessibilityClickAdapter(
        fakeNative({ tap: jest.fn(async () => Promise.reject(failure)) }),
      );
      const error = await adapter.tap(tapReq(1, 1), ctx()).catch((e) => e);
      expect(error).toBeInstanceOf(ClickError);
      expect(error).toMatchObject({ code, retryable });
    });

    it('recovers the error code from the message when the bridge drops it', async () => {
      const adapter = new AndroidAccessibilityClickAdapter(
        fakeNative({ tap: jest.fn(async () => Promise.reject(new Error('Call failed: ERR_BUSY'))) }),
      );
      await expect(adapter.tap(tapReq(1, 1), ctx())).rejects.toMatchObject({ code: 'REJECTED' });
    });
  });

  it('works end to end through the ClickEngine, retrying a rejected gesture', async () => {
    const tap = jest
      .fn<Promise<boolean>, [number, number, number]>()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const engine = new ClickEngine(new AndroidAccessibilityClickAdapter(fakeNative({ tap })), {
      minIntervalMs: 0,
      retryDelayMs: 0,
      maxRetries: 1,
    });
    await expect(engine.click({ x: 10, y: 20 })).resolves.toMatchObject({ attempts: 2 });
    expect(tap).toHaveBeenCalledTimes(2);
  });
});

describe('InAppTapRegistry', () => {
  const target = (id: string, bounds: InAppTarget['getBounds'] extends () => infer R ? R : never, extra: Partial<InAppTarget> = {}): InAppTarget => ({
    id,
    getBounds: () => bounds,
    onPress: jest.fn(),
    ...extra,
  });

  it('finds the target containing the point', () => {
    const registry = new InAppTapRegistry();
    const a = target('a', { left: 0, top: 0, width: 100, height: 50 });
    const b = target('b', { left: 200, top: 0, width: 100, height: 50 });
    registry.register(a);
    registry.register(b);

    expect(registry.hitTest(10, 10)).toBe(a);
    expect(registry.hitTest(250, 25)).toBe(b);
    expect(registry.hitTest(150, 25)).toBeNull();
  });

  it('includes the edges of the bounds', () => {
    const registry = new InAppTapRegistry();
    const a = target('a', { left: 10, top: 10, width: 10, height: 10 });
    registry.register(a);
    expect(registry.hitTest(10, 10)).toBe(a);
    expect(registry.hitTest(20, 20)).toBe(a);
    expect(registry.hitTest(21, 20)).toBeNull();
  });

  it('prefers the later-registered target when they overlap, unless zIndex says otherwise', () => {
    const registry = new InAppTapRegistry();
    const box = { left: 0, top: 0, width: 100, height: 100 };
    const under = target('under', box);
    const over = target('over', box);
    registry.register(under);
    registry.register(over);
    expect(registry.hitTest(5, 5)).toBe(over);

    const top = target('top', box, { zIndex: 10 });
    registry.register(top);
    registry.register(target('later', box));
    expect(registry.hitTest(5, 5)).toBe(top);
  });

  it('skips disabled targets and targets without bounds', () => {
    const registry = new InAppTapRegistry();
    const box = { left: 0, top: 0, width: 100, height: 100 };
    registry.register(target('disabled', box, { isEnabled: () => false }));
    registry.register(target('hidden', null));
    expect(registry.hitTest(5, 5)).toBeNull();
  });

  it('unregisters, and a stale unregister does not remove a newer target with the same id', () => {
    const registry = new InAppTapRegistry();
    const box = { left: 0, top: 0, width: 100, height: 100 };
    const first = target('same', box);
    const second = target('same', box);

    const offFirst = registry.register(first);
    registry.register(second);
    offFirst();
    expect(registry.hitTest(5, 5)).toBe(second);
    expect(registry.size).toBe(1);
  });
});

describe('InAppClickAdapter (iOS)', () => {
  const box = { left: 0, top: 0, width: 100, height: 100 };

  it('is honest about what it cannot do', () => {
    const { capabilities } = new InAppClickAdapter(new InAppTapRegistry());
    expect(capabilities).toMatchObject({
      crossApp: false,
      supportsDuration: false,
      coordinateSpace: 'window-points',
    });
  });

  it('presses the control at the coordinates, calling its onPress once', async () => {
    const registry = new InAppTapRegistry();
    const onPress = jest.fn();
    registry.register({ id: 'register', getBounds: () => box, onPress });

    await new InAppClickAdapter(registry).tap(tapReq(50, 50), ctx());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('awaits an async onPress', async () => {
    const registry = new InAppTapRegistry();
    let done = false;
    registry.register({
      id: 'slow',
      getBounds: () => box,
      onPress: async () => {
        await Promise.resolve();
        done = true;
      },
    });
    await new InAppClickAdapter(registry).tap(tapReq(5, 5), ctx());
    expect(done).toBe(true);
  });

  it('fails with NO_TARGET (not retryable) when nothing of the app is at that point', async () => {
    const adapter = new InAppClickAdapter(new InAppTapRegistry());
    const error = await adapter.tap(tapReq(5, 5), ctx()).catch((e) => e);
    expect(error).toMatchObject({ code: 'NO_TARGET', retryable: false });
    expect(error.message).toMatch(/other apps/);
  });

  it('reports a throwing handler as a non-retryable ADAPTER_ERROR', async () => {
    const registry = new InAppTapRegistry();
    registry.register({
      id: 'bad',
      getBounds: () => box,
      onPress: () => {
        throw new Error('handler bug');
      },
    });
    const error = await new InAppClickAdapter(registry).tap(tapReq(5, 5), ctx()).catch((e) => e);
    expect(error).toMatchObject({ code: 'ADAPTER_ERROR', retryable: false });
  });

  it('does nothing when already cancelled', async () => {
    const registry = new InAppTapRegistry();
    const onPress = jest.fn();
    registry.register({ id: 'a', getBounds: () => box, onPress });
    const controller = new AbortController();
    controller.abort();
    await expect(
      new InAppClickAdapter(registry).tap(tapReq(5, 5), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(onPress).not.toHaveBeenCalled();
  });

  it('blocks an accidental double press through the ClickEngine', async () => {
    const registry = new InAppTapRegistry();
    const onPress = jest.fn();
    registry.register({ id: 'register', getBounds: () => box, onPress });
    const engine = new ClickEngine(new InAppClickAdapter(registry), { minIntervalMs: 0 });

    await engine.click({ x: 50, y: 50 });
    await expect(engine.click({ x: 50, y: 50 })).rejects.toMatchObject({ code: 'DUPLICATE' });
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('UnsupportedClickAdapter / createClickAdapter', () => {
  it('never pretends to click', async () => {
    const adapter = new UnsupportedClickAdapter();
    expect((await adapter.getAvailability()).available).toBe(false);
    await expect(adapter.tap()).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(new ClickEngine(adapter).click({ x: 1, y: 1 })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('picks the adapter for each platform', () => {
    const registry = new InAppTapRegistry();
    expect(createClickAdapter('android', { androidNative: fakeNative() })).toBeInstanceOf(
      AndroidAccessibilityClickAdapter,
    );
    expect(createClickAdapter('android')).toBeInstanceOf(AndroidAccessibilityClickAdapter);
    expect(createClickAdapter('ios', { registry })).toBeInstanceOf(InAppClickAdapter);
    expect(createClickAdapter('web')).toBeInstanceOf(UnsupportedClickAdapter);
  });

  it('requires a registry on iOS', () => {
    expect(() => createClickAdapter('ios')).toThrow(/registry/);
  });
});
