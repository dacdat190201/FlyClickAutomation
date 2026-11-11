package expo.modules.flyclickaccessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent

/**
 * Performs tap gestures on request. It subscribes to no events and reads no window content
 * (see res/xml/fly_click_accessibility_service_config.xml); its only capability is
 * `canPerformGestures`.
 */
class FlyClickAccessibilityService : AccessibilityService() {

  enum class TapOutcome { COMPLETED, CANCELLED, REJECTED }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
  }

  private var controls: FloatingControls? = null

  /** Shows the floating bar. [onAction] receives "toggle" or "close". Main thread only. */
  fun showControls(playing: Boolean, onAction: (String) -> Unit) {
    val c = controls ?: FloatingControls(this).also { controls = it }
    c.show(playing, onAction)
  }

  fun setControlsPlaying(playing: Boolean) {
    controls?.setPlaying(playing)
  }

  fun hideControls() {
    controls?.hide()
  }

  override fun onUnbind(intent: android.content.Intent?): Boolean {
    hideControls()
    if (instance === this) instance = null
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    hideControls()
    if (instance === this) instance = null
    super.onDestroy()
  }

  // Intentionally empty: we neither inspect nor react to what is on screen.
  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  /**
   * Dispatches a single-point gesture at physical pixel (x, y) held for [durationMs].
   * [onResult] is called exactly once, on the main thread.
   */
  fun performTap(x: Float, y: Float, durationMs: Long, onResult: (TapOutcome) -> Unit) {
    val path = Path().apply { moveTo(x, y) }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0L, durationMs))
      .build()

    val callback = object : AccessibilityService.GestureResultCallback() {
      override fun onCompleted(gestureDescription: GestureDescription?) = onResult(TapOutcome.COMPLETED)
      override fun onCancelled(gestureDescription: GestureDescription?) = onResult(TapOutcome.CANCELLED)
    }

    // `false` means Android did not accept the gesture at all; the callback will not be invoked.
    if (!dispatchGesture(gesture, callback, null)) {
      onResult(TapOutcome.REJECTED)
    }
  }

  companion object {
    /** Set while the user has the service enabled and Android has connected it. */
    @Volatile
    var instance: FlyClickAccessibilityService? = null
      private set
  }
}
