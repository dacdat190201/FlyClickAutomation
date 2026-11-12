package expo.modules.flyclickaccessibility

import android.content.Context
import android.content.Intent
import android.graphics.Point
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.WindowManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicBoolean

/**
 * JavaScript bridge. Mirrors `FlyClickNativeModule` in
 * src/click/adapters/android-accessibility-adapter.ts. Keep the two in sync.
 *
 * Error codes: ERR_SERVICE_NOT_CONNECTED, ERR_BUSY, ERR_OUT_OF_BOUNDS, ERR_INVALID_DURATION,
 * ERR_DISPATCH_REJECTED.
 */
class FlyClickAccessibilityModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /** Only one gesture at a time, so a retry can never overlap a tap that is still running. */
  private val gestureInFlight = AtomicBoolean(false)
  private val mainHandler = Handler(Looper.getMainLooper())

  /**
   * Wraps the gesture callback so the promise settles exactly once and the busy flag is always
   * released. A touch on the screen can interrupt an injected gesture and, on some devices, no
   * callback arrives at all; the watchdog then reports "cancelled" so the caller can carry on.
   */
  private fun settleOnce(expectedMs: Long, promise: Promise): (FlyClickAccessibilityService.TapOutcome) -> Unit {
    val done = AtomicBoolean(false)
    val settle = { outcome: FlyClickAccessibilityService.TapOutcome ->
      if (done.compareAndSet(false, true)) {
        gestureInFlight.set(false)
        when (outcome) {
          FlyClickAccessibilityService.TapOutcome.COMPLETED -> promise.resolve(true)
          FlyClickAccessibilityService.TapOutcome.CANCELLED -> promise.resolve(false)
          FlyClickAccessibilityService.TapOutcome.REJECTED ->
            promise.reject("ERR_DISPATCH_REJECTED", "Android did not accept the gesture.", null)
        }
      }
    }
    mainHandler.postDelayed({ settle(FlyClickAccessibilityService.TapOutcome.CANCELLED) }, expectedMs + 700)
    return settle
  }

  override fun definition() = ModuleDefinition {
    Name("FlyClickAccessibility")

    Events("onFloatingAction", "onPointPicker")

    OnDestroy {
      mainHandler.post { FlyClickAccessibilityService.instance?.hideControls() }
    }

    // Shows the draggable control bar over other apps. Returns false if the service is not on.
    AsyncFunction("showFloatingControls") { playing: Boolean, promise: Promise ->
      val service = FlyClickAccessibilityService.instance
      if (service == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      mainHandler.post {
        service.showControls(playing) { action -> sendEvent("onFloatingAction", mapOf("action" to action)) }
        promise.resolve(true)
      }
    }

    Function("setFloatingPlaying") { playing: Boolean ->
      mainHandler.post { FlyClickAccessibilityService.instance?.setControlsPlaying(playing) }
    }

    AsyncFunction("showPointPicker") { promise: Promise ->
      val service = FlyClickAccessibilityService.instance
      if (service == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      mainHandler.post {
        service.showPicker { action, x, y ->
          sendEvent("onPointPicker", mapOf("action" to action, "x" to x, "y" to y))
        }
        promise.resolve(true)
      }
    }

    Function("hidePointPicker") {
      mainHandler.post { FlyClickAccessibilityService.instance?.hidePicker() }
    }

    // Numbered dots for saved points; [flat] is x1, y1, x2, y2, ... in screen pixels.
    Function("setPointDots") { flat: List<Double> ->
      mainHandler.post { FlyClickAccessibilityService.instance?.setPickerDots(flat) }
    }

    Function("setFloatingStatus") { text: String ->
      mainHandler.post { FlyClickAccessibilityService.instance?.setControlsStatus(text) }
    }

    // [size] is the ring diameter in pixels (0 = default).
    Function("showTapMarker") { x: Double, y: Double, label: String, size: Double ->
      mainHandler.post {
        FlyClickAccessibilityService.instance?.showTapMarker(x.toInt(), y.toInt(), label, size.toInt())
      }
    }

    // Up to 20 taps in one gesture. [flat] = x1,y1,x2,y2,...; taps cycle through the points.
    AsyncFunction("tapSequence") { flat: List<Double>, count: Int, durationMs: Double, gapMs: Double, promise: Promise ->
      val service = FlyClickAccessibilityService.instance
      if (service == null) {
        promise.reject("ERR_SERVICE_NOT_CONNECTED", "The accessibility service is not enabled or not connected.", null)
        return@AsyncFunction
      }
      if (flat.size < 2 || flat.size % 2 != 0 || count < 1 || count > 20 ||
        durationMs.isNaN() || durationMs < 1.0 || gapMs.isNaN() || gapMs < 0.0
      ) {
        promise.reject("ERR_INVALID_DURATION", "Invalid tap sequence.", null)
        return@AsyncFunction
      }
      val size = Point()
      @Suppress("DEPRECATION")
      (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealSize(size)
      for (i in flat.indices step 2) {
        if (flat[i].isNaN() || flat[i + 1].isNaN() || flat[i] < 0 || flat[i + 1] < 0 || flat[i] > size.x || flat[i + 1] > size.y) {
          promise.reject("ERR_OUT_OF_BOUNDS", "A point is outside the ${size.x}x${size.y} screen.", null)
          return@AsyncFunction
        }
      }
      if (!gestureInFlight.compareAndSet(false, true)) {
        promise.reject("ERR_BUSY", "Another tap is still in progress.", null)
        return@AsyncFunction
      }
      mainHandler.post {
        val total = count * (durationMs.toLong() + gapMs.toLong())
        service.performTapSequence(flat, count, durationMs.toLong(), gapMs.toLong(), settleOnce(total, promise))
      }
    }

    Function("hideFloatingControls") {
      mainHandler.post { FlyClickAccessibilityService.instance?.hideControls() }
    }

    Function("isServiceEnabled") {
      FlyClickAccessibilityService.instance != null
    }

    // Text nodes of the window in front, or null if none. Includes our own package name so that
    // JavaScript can refuse to act on FlyClick's own screen.
    Function("snapshot") {
      val snap = FlyClickAccessibilityService.instance?.snapshot() ?: return@Function null
      snap + ("self" to context.packageName)
    }

    // The app cannot enable an accessibility service itself; the user must do it in Settings.
    Function("openAccessibilitySettings") {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    AsyncFunction("swipe") { x1: Double, y1: Double, x2: Double, y2: Double, durationMs: Double, promise: Promise ->
      val service = FlyClickAccessibilityService.instance
      if (service == null) {
        promise.reject("ERR_SERVICE_NOT_CONNECTED", "The accessibility service is not enabled or not connected.", null)
        return@AsyncFunction
      }
      val maxDuration = android.accessibilityservice.GestureDescription.getMaxGestureDuration()
      if (durationMs.isNaN() || durationMs < 1.0 || durationMs > maxDuration) {
        promise.reject("ERR_INVALID_DURATION", "durationMs must be between 1 and $maxDuration.", null)
        return@AsyncFunction
      }
      val size = Point()
      @Suppress("DEPRECATION")
      (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealSize(size)
      val points = listOf(x1, y1, x2, y2)
      if (points.any { it.isNaN() || it < 0 } || x1 > size.x || x2 > size.x || y1 > size.y || y2 > size.y) {
        promise.reject("ERR_OUT_OF_BOUNDS", "Swipe is outside the ${size.x}x${size.y} screen.", null)
        return@AsyncFunction
      }
      if (!gestureInFlight.compareAndSet(false, true)) {
        promise.reject("ERR_BUSY", "Another gesture is still in progress.", null)
        return@AsyncFunction
      }
      mainHandler.post {
        service.performSwipe(
          x1.toFloat(), y1.toFloat(), x2.toFloat(), y2.toFloat(), durationMs.toLong(),
          settleOnce(durationMs.toLong(), promise),
        )
      }
    }

    AsyncFunction("tap") { x: Double, y: Double, durationMs: Double, promise: Promise ->
      val service = FlyClickAccessibilityService.instance
      if (service == null) {
        promise.reject("ERR_SERVICE_NOT_CONNECTED", "The accessibility service is not enabled or not connected.", null)
        return@AsyncFunction
      }

      // GestureDescription limits the stroke length; also reject non-positive durations.
      val maxDuration = android.accessibilityservice.GestureDescription.getMaxGestureDuration()
      if (durationMs.isNaN() || durationMs < 1.0 || durationMs > maxDuration) {
        promise.reject("ERR_INVALID_DURATION", "durationMs must be between 1 and $maxDuration.", null)
        return@AsyncFunction
      }

      val size = Point()
      @Suppress("DEPRECATION")
      (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.getRealSize(size)
      if (x.isNaN() || y.isNaN() || x < 0 || y < 0 || x > size.x || y > size.y) {
        promise.reject("ERR_OUT_OF_BOUNDS", "($x, $y) is outside the ${size.x}x${size.y} screen.", null)
        return@AsyncFunction
      }

      if (!gestureInFlight.compareAndSet(false, true)) {
        promise.reject("ERR_BUSY", "Another tap is still in progress.", null)
        return@AsyncFunction
      }

      // dispatchGesture is invoked on the main thread, as the framework expects.
      mainHandler.post {
        service.performTap(x.toFloat(), y.toFloat(), durationMs.toLong(), settleOnce(durationMs.toLong(), promise))
      }
    }
  }
}
