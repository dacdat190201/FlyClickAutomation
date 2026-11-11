# Click Engine

`src/click/` performs click requests safely on top of a per-platform `ClickAdapter`.
It is independent of UI and of any native code; only `src/click/native/android-native.ts` looks up the native module.

## Architecture

```
ClickEngine  (timeout, retry, interval, repeat guard, verification)
   │
   └── ClickAdapter  (interface)
         ├── AndroidAccessibilityClickAdapter ──► modules/fly-click-accessibility (Kotlin AccessibilityService)
         ├── InAppClickAdapter (iOS)          ──► InAppTapRegistry (this app's own controls only)
         └── UnsupportedClickAdapter (web)    ──► always refuses
```

`createClickAdapter(Platform.OS, { androidNative, registry })` picks the adapter.

### What the engine guarantees

| Requirement | Behaviour |
|---|---|
| Coordinate click | `engine.click({ x, y })`. Coordinates are validated (finite, ≥ 0). |
| Tap duration | `durationMs` per request (default 50 ms, max `maxDurationMs`). Adapters report `capabilities.supportsDuration`. |
| Click interval | `minIntervalMs` enforced between the end of one click and the start of the next (waits, abortable). |
| Timeout | `timeoutMs` per attempt; the adapter's `AbortSignal` is aborted. |
| Retry | `maxRetries`, `retryDelayMs`. Only errors flagged `retryable` are retried, meaning the tap definitely did not happen. **Timeouts are not retried by default** (`retryOnTimeout`), since the tap may have landed and a retry could click twice. |
| Verify before continuing | `click(req, { verify })` polls the verifier (`verifyIntervalMs` up to `verifyTimeoutMs`). `click()` only resolves once it passes; otherwise it rejects with `VERIFICATION_FAILED` (retryable). Without a verifier, `result.verified` is `null`. |
| No accidental repeats | One click at a time (a concurrent call is rejected); same point (± `duplicateRadius`) within `duplicateWindowMs` is rejected with `DUPLICATE`. `allowRepeat: true` opts out for intentional double taps. |

Coordinates are in the **adapter's** space (`capabilities.coordinateSpace`): physical screen pixels on Android, React Native window points on iOS. OCR boxes are in image pixels, so a scaling step is needed before feeding them to the engine.

## Android

Implemented in `modules/fly-click-accessibility` (a local Expo module, autolinked):

- `FlyClickAccessibilityService.kt`: an `AccessibilityService` with `canPerformGestures`, using `dispatchGesture` for taps.
- `FlyClickAccessibilityModule.kt`: JS bridge (`isServiceEnabled`, `openAccessibilitySettings`, `tap`). One gesture at a time.
- `AndroidManifest.xml` and `res/xml/fly_click_accessibility_service_config.xml`: service declaration (merged into the app manifest).

The service can read the text of the window in front (`canRetrieveWindowContent="true"`, used by `src/auto`, see docs/auto-registration.md) and listens only to window-change events. `isAccessibilityTool` is deliberately **not** set.

**Requires:** a development build or production build (not Expo Go) and the user enabling the service in *Settings → Accessibility*. An app cannot enable it itself; the adapter reports `action: 'enable-accessibility-service'` and `openAccessibilitySettings()` takes the user there.

**Status: written but not compiled or run.** No Android SDK was available when this was authored. Expect to fix small compile issues on first build, and test on a real device.

### Google Play policy (check before publishing)

Based on Google's AccessibilityService API policy as read on 2026-11-10 (policies change; re-read before release):

- The API is restricted. Only apps that help people with disabilities may declare themselves accessibility tools. Automation tools are listed as *not* accessibility tools.
- For apps that are not accessibility tools, autonomous behaviour ("autonomously initiate, plan, and execute actions or decisions") is strictly prohibited. Deterministic, rule-based automation that follows a static, human-defined script is not prohibited by that rule.
- A **Permissions Declaration / accessibility declaration** in Play Console is required, explaining why the API is needed and what data is handled.
- A **prominent in-app disclosure with affirmative consent** is required, shown during normal use and not only in a privacy policy. **This is not implemented yet.** It must exist before any Play release.
- Whether an OCR-driven auto-clicker is accepted is Google's call and is a real risk. Plan an alternative (direct APK distribution) if it is rejected.

## iOS

iOS does not let an app tap inside other apps or the system UI. The iOS adapter therefore does only what is supported:

- `InAppClickAdapter` hit-tests the requested window coordinates against controls that **this app** registered in an `InAppTapRegistry`, and calls that control's own `onPress`.
- It does **not** synthesize touch events, does not ignore the sandbox, and does not pretend to click elsewhere. Anything outside the app's registered controls fails with `NO_TARGET`.
- Tap duration is ignored (`supportsDuration: false`); there is no real touch to hold.

Registering a control (example):

```tsx
useEffect(() => registry.register({
  id: 'register-button',
  getBounds: () => layoutRef.current,   // window coordinates, e.g. cached from measureInWindow
  onPress: handleRegister,              // the same handler the real button runs
}), []);
```

### Unavailable on iOS (as far as public APIs go; verify against current Apple documentation)

| Idea | Why it does not work |
|---|---|
| Send touches to other apps / SpringBoard | No public API. Private APIs (e.g. HID event injection) are forbidden by App Store review and unavailable to normal apps. |
| An iOS equivalent of Android's AccessibilityService gestures | `UIAccessibility` lets an app describe its **own** UI to assistive tech; it gives no way to drive other apps. |
| XCUITest / XCTest | Can drive other apps by bundle ID, but only from a UI-test runner started from Xcode on a Mac. It cannot ship inside an app. |
| ReplayKit / broadcast upload extension | Can capture the screen, but can only observe, not inject input. |
| AssistiveTouch, Switch Control, Voice Control, Shortcuts | User-level system features, not APIs apps can call. To our knowledge Shortcuts has no "tap at coordinates" action. |
| Camera as a "screenshot" source | A camera sees the physical world, not other apps' screens. |

Net effect: on iOS, OCR plus clicking can only automate this app's own screens. Cross-app automation is not possible from an iOS app.

## Not done yet

- No UI wiring of the Click Engine (no screen calls it yet).
- Android consent/disclosure screen (see above).
- Coordinate mapping from OCR image pixels to screen coordinates.
- A bridge from `ClickEngine` to the Automation Engine's `AutomationAdapter`.
