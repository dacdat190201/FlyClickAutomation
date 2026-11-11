# Auto registration (Android, personal use)

`src/auto/` clicks "Đăng ký" in **another app** and walks its tabs. It does not use OCR or screenshots:
the accessibility service reads the text nodes of the window in front.

```
Floating bar (Start/Stop) ─► useAutoRunner ─► runAutomation (src/auto/runner.ts)
                                                 ├─ native.snapshot()  text + bounds of the front window
                                                 └─ native.tap(x, y)   gesture at the node centre
```

Per tab: find a node containing a target keyword that is not a success text ("Đã đăng ký" contains "đăng ký", so success text is excluded), tap it, then poll until it turned into success text or disappeared. Not verified within `verifyMs` = failed attempt; after `maxRetriesPerTarget` retries the button is skipped (tab ends `failed`, run `partial`). When no target is left (confirmed by two scans) the next tab is opened by tapping the node whose text equals its name. The first tab is assumed to be open.

Safeguards: `maxRunMs` (10 min), `maxClicks` (500), nothing happens while FlyClick itself is in front, Stop aborts at the next step. Each run is saved to History.

Matching ignores case and diacritics. Only visible text/content-description nodes are read, and only when a snapshot is requested.

## Using it
1. Build a development build (`npx expo run:android`), enable *FlyClick* in Settings → Accessibility. **After updating the app, toggle the service off/on** because its capabilities changed.
2. Home → set tabs ("Thứ 2, Thứ 3"), button text and success text → "Hiện thanh điều khiển nổi".
3. Open the target app on its first tab, press play on the floating bar.

## Limits
- Not run on a device yet: the Kotlin and the real texts of your app are untested. If a button's text is not exposed to accessibility (custom-drawn UI, WebView without labels) it will not be found.
- No scrolling: only visible buttons are processed.
- JS must stay alive in the background; if Android kills the app process the run stops.

## Speed, click count and tap markers
- **Tốc độ** presets (`SPEED_PRESETS` in `src/auto/types.ts`): *Nhanh* checks the screen every 40 ms right after a click, taps for 10 ms and re-taps a button that did not change after 700 ms. *Vừa* and *Chậm* wait longer. Each cycle is one native snapshot + one gesture, so the real rate is bounded by Android (roughly 5-15 clicks/s is realistic; measure on the device).
- The click count shows on the floating bar and in the home card. With "Hiện điểm chạm" on, a red ring with the click number flashes at each tap (`TapMarker.kt`, a non-touchable overlay).
- Clicks are always verified against the screen, never fired blindly in bursts: tapping a button that has already turned into "Đã đăng ký" could cancel the registration.

## Tab bar that scrolls sideways
Only visible text is readable, so a tab outside the scrolled area is invisible. When the next tab's label is not found, `openTab` takes another configured tab that is on screen as an anchor (it marks the tab bar's row), swipes that row towards later tabs, rescans, and repeats. When a swipe changes nothing (end of the bar) it swipes the other way once; if the tab is still missing the run ends `partial` with `TAB_NOT_FOUND`. Tab labels must match the text in the app (case and accents are ignored).
Vertical lists of buttons are not scrolled yet.

## Click theo điểm (macro by position)
Mode `points` in `AutoConfig`. No text is read; the tool clicks saved screen positions in order.
- **Choosing points:** the ◎ button on the floating bar (or "Chọn điểm" in the app) opens `PointPicker.kt`: a draggable crosshair with "Lưu" and "Xong". "Lưu" reports the crosshair's centre in screen pixels (`onPointPicker` event) and the point is appended to `config.points`; saved points stay on screen as numbered dots until "Xong". Points are stored in AsyncStorage with the rest of the config.
- **Running:** `runPoints` (`src/auto/runner.ts`) taps the points in order, `pointRounds` times (0 = until stopped), pausing `pointIntervalMs` after each. It never taps while FlyClick itself is in front (checked every 5 taps). Hard cap: 100 000 clicks.
- Coordinates are physical pixels of this device and the current orientation: if the other app's layout shifts, the points miss. Points are blind clicks (no check of the screen).
