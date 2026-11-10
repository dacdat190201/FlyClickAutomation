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

  override fun definition() = ModuleDefinition {
    Name("FlyClickAccessibility")

    Function("isServiceEnabled") {
      FlyClickAccessibilityService.instance != null
    }

    // The app cannot enable an accessibility service itself; the user must do it in Settings.
    Function("openAccessibilitySettings") {
      val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
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
        service.performTap(x.toFloat(), y.toFloat(), durationMs.toLong()) { outcome ->
          gestureInFlight.set(false)
          when (outcome) {
            FlyClickAccessibilityService.TapOutcome.COMPLETED -> promise.resolve(true)
            FlyClickAccessibilityService.TapOutcome.CANCELLED -> promise.resolve(false)
            FlyClickAccessibilityService.TapOutcome.REJECTED ->
              promise.reject("ERR_DISPATCH_REJECTED", "Android did not accept the gesture.", null)
          }
        }
      }
    }
  }
}
