package expo.modules.flyclickaccessibility

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.TextView

/**
 * A red ring with the click number that flashes where a tap is sent, so you can see where and
 * how often the tool clicks. One view is reused, so very fast taps cost almost nothing.
 * Not touchable and not focusable: it never blocks the tap itself. Main thread only.
 */
class TapMarker(private val service: AccessibilityService) {
  private val windowManager = service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
  private val size = (44 * service.resources.displayMetrics.density).toInt()
  private var view: TextView? = null
  private var params: WindowManager.LayoutParams? = null

  /** [sizePx] > 0 sizes the ring to e.g. the clicked button; otherwise the default 44dp. */
  fun show(x: Int, y: Int, label: String, sizePx: Int = 0) {
    val v = view ?: create()
    val lp = params ?: return
    val s = if (sizePx > 0) maxOf(sizePx, size) else size
    lp.width = s
    lp.height = s
    lp.x = x - s / 2
    lp.y = y - s / 2
    v.text = label
    v.animate().cancel()
    v.alpha = 1f
    v.scaleX = 0.85f
    v.scaleY = 0.85f
    runCatching { windowManager.updateViewLayout(v, lp) }
    v.animate().alpha(0f).scaleX(1.2f).scaleY(1.2f).setDuration(250).start()
  }

  private fun create(): TextView {
    val v = TextView(service).apply {
      textSize = 11f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      alpha = 0f
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#66FF3B30"))
        setStroke((3 * service.resources.displayMetrics.density).toInt(), Color.parseColor("#FFFF3B30"))
      }
    }
    val lp = WindowManager.LayoutParams(
      size,
      size,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      PixelFormat.TRANSLUCENT,
    ).apply { gravity = Gravity.TOP or Gravity.START }
    windowManager.addView(v, lp)
    view = v
    params = lp
    return v
  }

  fun hide() {
    view?.let {
      it.animate().cancel()
      runCatching { windowManager.removeView(it) }
    }
    view = null
    params = null
  }
}
