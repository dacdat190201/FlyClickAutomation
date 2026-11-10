# Smart Registration Workflow

`src/workflow/` connects the three engines:

```
SmartRegistrationWorkflow
 ├── AutomationEngine (src/engine)   one task per tab: pause / resume / stop, ERROR state
 ├── OcrService       (src/ocr)      find "Đăng ký" buttons and "Đã đăng ký" proof
 ├── ClickEngine      (src/click)    one safe click, with verification
 └── ScreenSource     (port)         where authorised screen images come from
```

## The loop (per tab)

| # | Step | Where |
|---|---|---|
| 1 | Capture an authorised screen image | `ScreenSource.capture` |
| 2 | Run OCR | `OcrService.scan` |
| 3 | Find all "Đăng ký" targets | `scan.targets` (reading order) |
| 4 | Pick the first unprocessed target | `TargetTracker` |
| 5 | Execute one click | `ClickEngine.click` |
| 6 | Wait for the UI to update | `settleDelayMs`, then polling |
| 7 | Run OCR again | verifier calls `scan` |
| 8 | Verify "Đã đăng ký" | success text must be **new and next to the clicked target** |
| 9 | Mark the target completed | `TabResult.registered` |
| 10 | Continue with the next target | loop |
| 11 | No targets left: open the next configured tab | OCR finds the tab label and clicks it |
| 12 | Repeat until all tabs are done | one Automation Engine task per tab |

If the click adapter cannot click the tab button (for example iOS, where only this app's own registered controls can be pressed), the run ends as `partial` with `reason: 'NAVIGATION_UNSUPPORTED'` and the remaining tabs marked `not-reached`.

## Safeguards

- **Maximum retry count:** `maxRetriesPerTarget` (default 2). After that the target is recorded in `failed` and skipped; the run continues with the others and ends `partial`.
- **Maximum execution time:** `maxExecutionMs` (default 10 min) stops the run; result `timeout`.
- **Maximum clicks:** `maxClicks` (default 500) guarantees the loop ends; reason `MAX_CLICKS`.
- **Unexpected screen change:** the non-keyword lines of the screen are compared between scans (Jaccard similarity). Below `minScreenSimilarity` (default 0.5) the run stops with `UNEXPECTED_SCREEN`. Keyword lines are excluded, so a button turning into "Đã đăng ký" is not a surprise. It is also checked during verification polls, so a popup caused by the click is caught immediately.
- **Never click a successful target twice:** targets are tracked by position. A registered target is never selected again. If verification timed out but a later scan shows success where we clicked, the target is confirmed instead of re-clicked.
- **Other duplicate protection:** the Click Engine's one-at-a-time and same-point guards apply to the first attempt of every target (retries opt out on purpose).
- **Log of every action:** each step writes a `WorkflowLogEntry` (`capture`, `ocr`, `find`, `select`, `click`, `wait`, `verify`, `mark`, `next`, `navigate`, `safeguard`, `run`) to `result.log` and to `deps.onLog`.

## Using it

```ts
const workflow = new SmartRegistrationWorkflow(
  {
    screen,                                         // a ScreenSource (see below)
    ocr: new OcrService(new MlKitTextRecognizer()),
    clicker: new ClickEngine(adapter, { maxRetries: 0, verifyTimeoutMs: 3000 }),
    onLog: (entry) => console.log(entry),
  },
  {
    targetKeywords: ['Đăng ký'],
    successKeywords: ['Đã đăng ký'],
    tabs: [{ name: 'Khóa học' }, { name: 'Sự kiện', verifyKeyword: 'Danh sách sự kiện' }],
  },
);
const result = await workflow.runToEnd();   // or start() / pause() / resume() / stop() / whenDone()
```

`result.status` is `completed`, `partial`, `stopped`, `timeout` or `failed`, with `reason`, per-tab results and the full log.

Configure the Click Engine with `maxRetries: 0` and a `verifyTimeoutMs` long enough for the app to update; retrying is handled by the workflow, after a fresh scan.

## Authorised screen images: what exists and what does not

The workflow only needs a `ScreenSource` that returns an image URI the app may read. **No real `ScreenSource` is implemented yet.** Realistic options:

- **iOS:** capture this app's own views (for example `react-native-view-shot`). This is authorised because it is the app's own UI. iOS cannot capture other apps.
- **Android:** `MediaProjection` needs the user's consent through the system dialog each session and a foreground service, and it is also subject to Google Play policy.
- A camera is not a screenshot source.

Until one is built, the workflow runs against a simulated app in the tests (`src/workflow/__fixtures__/sim-app.ts`), not a real device.

## Known limits

- OCR coordinates are image pixels; the Click Engine expects its adapter's coordinate space (screen pixels on Android). Add a scaling step in the `ScreenSource` or adapter if the image is not at screen resolution.
- Pause takes effect at the next step boundary; a click already in flight finishes first.
- A click whose verification fails is retried after a rescan. If the app updates very late, there is a small chance of a second tap on a button that had in fact registered.
- No scrolling: only targets visible on screen are processed.
- No UI screen runs the workflow yet.
