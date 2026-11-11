package expo.modules.flyclickaccessibility

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Lets the user choose click positions without knowing coordinates: a draggable crosshair with
 * "Lưu" (save) and "Xong" (done) buttons floats above other apps. The centre of the crosshair is
 * reported on Save. Saved points stay visible as numbered dots (not touchable). Main thread only.
 */
class PointPicker(private val service: AccessibilityService) {
  private val windowManager = service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
  private val density = service.resources.displayMetrics.density
  private fun dp(v: Int) = (v * density).toInt()

  private var root: FloatingControls.DraggableBar? = null
  private val dots = ArrayList<TextView>()

  val isShowing: Boolean get() = root != null

  /** [onAction] gets ("save", x, y) with the crosshair centre in screen pixels, or ("done", 0, 0). */
  fun show(onAction: (String, Int, Int) -> Unit) {
    if (root != null) return

    val bar = FloatingControls.DraggableBar(service).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(4), dp(4), dp(4), dp(4))
    }

    val cross = TextView(service).apply {
      text = "+"
      textSize = 30f
      setTextColor(Color.WHITE)
      gravity = Gravity.CENTER
      layoutParams = LinearLayout.LayoutParams(dp(56), dp(56))
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#33FF3B30"))
        setStroke(dp(3), Color.parseColor("#FFFF3B30"))
      }
    }

    fun button(label: String, color: String, action: () -> Unit) = TextView(service).apply {
      text = label
      textSize = 14f
      setTextColor(Color.WHITE)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      setPadding(dp(14), dp(8), dp(14), dp(8))
      background = GradientDrawable().apply {
        setColor(Color.parseColor(color))
        cornerRadius = dp(16).toFloat()
      }
      setOnClickListener { action() }
    }

    val row = LinearLayout(service).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }
    val save = button("Lưu", "#E6208AEF") {
      val loc = IntArray(2)
      cross.getLocationOnScreen(loc)
      onAction("save", loc[0] + cross.width / 2, loc[1] + cross.height / 2)
    }
    val done = button("Xong", "#E6444444") { onAction("done", 0, 0) }
    row.addView(save)
    row.addView(View(service), LinearLayout.LayoutParams(dp(6), 1))
    row.addView(done)

    bar.addView(cross)
    bar.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
      topMargin = dp(4)
    })

    val metrics = service.resources.displayMetrics
    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = metrics.widthPixels / 2 - dp(60)
      y = metrics.heightPixels / 2 - dp(40)
    }
    bar.onDrag = { dx, dy ->
      lp.x += dx
      lp.y += dy
      runCatching { windowManager.updateViewLayout(bar, lp) }
    }

    windowManager.addView(bar, lp)
    root = bar
  }

  /** Replaces the numbered dots. [flat] is x1, y1, x2, y2, ... in screen pixels. */
  fun setDots(flat: List<Double>) {
    clearDots()
    val size = dp(28)
    var i = 0
    while (i + 1 < flat.size) {
      val x = flat[i].toInt()
      val y = flat[i + 1].toInt()
      val dot = TextView(service).apply {
        text = ((i / 2) + 1).toString()
        textSize = 12f
        setTextColor(Color.WHITE)
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        background = GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(Color.parseColor("#CC208AEF"))
          setStroke(dp(2), Color.WHITE)
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
      ).apply {
        gravity = Gravity.TOP or Gravity.START
        this.x = x - size / 2
        this.y = y - size / 2
      }
      if (runCatching { windowManager.addView(dot, lp) }.isSuccess) dots.add(dot)
      i += 2
    }
  }

  private fun clearDots() {
    dots.forEach { runCatching { windowManager.removeView(it) } }
    dots.clear()
  }

  fun hide() {
    root?.let { runCatching { windowManager.removeView(it) } }
    root = null
    clearDots()
  }
}
