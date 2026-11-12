package expo.modules.flyclickaccessibility

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Performs tap gestures and reads the text of the window in front, both on request
 * (see res/xml/fly_click_accessibility_service_config.xml). Events are ignored.
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
    marker?.hide()
    picker?.hide()
  }

  private var picker: PointPicker? = null

  /** Shows the crosshair picker. [onAction] gets ("save", x, y) or ("done", 0, 0). Main thread only. */
  fun showPicker(onAction: (String, Int, Int) -> Unit) {
    val p = picker ?: PointPicker(this).also { picker = it }
    p.show(onAction)
  }

  fun hidePicker() {
    picker?.hide()
  }

  fun setPickerDots(flat: List<Double>) {
    picker?.setDots(flat)
  }

  fun setControlsStatus(text: String) {
    controls?.setStatus(text)
  }

  private var marker: TapMarker? = null

  /** Flashes a ring with [label] at screen pixel (x, y). Main thread only. */
  fun showTapMarker(x: Int, y: Int, label: String, sizePx: Int) {
    val m = marker ?: TapMarker(this).also { marker = it }
    m.show(x, y, label, sizePx)
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

  // Intentionally empty: the screen is only read when JavaScript asks for a snapshot.
  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  /**
   * Flattens the active window into text nodes: `{ pkg, nodes: [{ text, x, y, w, h, clickable }] }`
   * (screen pixels). Returns null when no window is available (e.g. during a transition).
   */
  fun snapshot(): Map<String, Any>? {
    val root = rootInActiveWindow ?: return null
    val nodes = ArrayList<Map<String, Any>>()
    val bounds = android.graphics.Rect()

    fun walk(node: AccessibilityNodeInfo, depth: Int) {
      if (nodes.size >= MAX_NODES || depth > MAX_DEPTH) return
      val label = node.text?.toString()?.takeIf { it.isNotBlank() }
        ?: node.contentDescription?.toString()?.takeIf { it.isNotBlank() }
      if (label != null && node.isVisibleToUser) {
        node.getBoundsInScreen(bounds)
        if (bounds.width() > 0 && bounds.height() > 0) {
          nodes.add(
            mapOf(
              "text" to label,
              "x" to bounds.left, "y" to bounds.top,
              "w" to bounds.width(), "h" to bounds.height(),
              "clickable" to node.isClickable,
            ),
          )
        }
      }
      for (i in 0 until node.childCount) {
        val child = node.getChild(i) ?: continue
        walk(child, depth + 1)
      }
    }

    walk(root, 0)
    return mapOf("pkg" to (root.packageName?.toString() ?: ""), "nodes" to nodes)
  }

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

  /**
   * Dispatches several taps as ONE gesture: stroke i taps point `i % points` at i * (duration + gap) ms.
   * No JavaScript round trip between taps, so cadence is exact even at a few ms. [flat] is x1,y1,x2,y2...
   */
  fun performTapSequence(
    flat: List<Double>, count: Int, durationMs: Long, gapMs: Long, onResult: (TapOutcome) -> Unit,
  ) {
    val n = flat.size / 2
    val builder = GestureDescription.Builder()
    val step = durationMs + gapMs
    for (i in 0 until count) {
      val px = flat[(i % n) * 2].toFloat()
      val py = flat[(i % n) * 2 + 1].toFloat()
      val path = Path().apply { moveTo(px, py) }
      builder.addStroke(GestureDescription.StrokeDescription(path, i * step, durationMs))
    }
    val callback = object : AccessibilityService.GestureResultCallback() {
      override fun onCompleted(gestureDescription: GestureDescription?) = onResult(TapOutcome.COMPLETED)
      override fun onCancelled(gestureDescription: GestureDescription?) = onResult(TapOutcome.CANCELLED)
    }
    if (!dispatchGesture(builder.build(), callback, null)) onResult(TapOutcome.REJECTED)
  }

  /** Dispatches a straight swipe (used to scroll a tab bar). [onResult] is called once, main thread. */
  fun performSwipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long, onResult: (TapOutcome) -> Unit) {
    val path = Path().apply {
      moveTo(x1, y1)
      lineTo(x2, y2)
    }
    val gesture = GestureDescription.Builder()
      .addStroke(GestureDescription.StrokeDescription(path, 0L, durationMs))
      .build()
    val callback = object : AccessibilityService.GestureResultCallback() {
      override fun onCompleted(gestureDescription: GestureDescription?) = onResult(TapOutcome.COMPLETED)
      override fun onCancelled(gestureDescription: GestureDescription?) = onResult(TapOutcome.CANCELLED)
    }
    if (!dispatchGesture(gesture, callback, null)) onResult(TapOutcome.REJECTED)
  }

  companion object {
    /** Set while the user has the service enabled and Android has connected it. */
    private const val MAX_NODES = 1500
    private const val MAX_DEPTH = 60

    @Volatile
    var instance: FlyClickAccessibilityService? = null
      private set
  }
}
