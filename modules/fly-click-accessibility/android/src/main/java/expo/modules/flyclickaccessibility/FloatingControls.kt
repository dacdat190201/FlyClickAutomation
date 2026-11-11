package expo.modules.flyclickaccessibility

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView

/**
 * A small vertical control bar drawn above other apps through the accessibility service
 * (TYPE_ACCESSIBILITY_OVERLAY), so no "draw over other apps" permission is needed.
 * It can be dragged; it has a play/pause toggle, a button that opens the point picker, and a close button. All calls: main thread.
 */
class FloatingControls(private val service: AccessibilityService) {

  private val windowManager = service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
  private var root: DraggableBar? = null
  private var playButton: TextView? = null
  private var statusView: TextView? = null
  private var status = "0"
  private var params: WindowManager.LayoutParams? = null

  /** Last position, kept so the bar reappears where the user left it. */
  private var lastX = 0
  private var lastY = 0
  private var positioned = false

  val isShowing: Boolean get() = root != null

  fun show(playing: Boolean, onAction: (String) -> Unit) {
    if (root != null) {
      setPlaying(playing)
      return
    }
    val density = service.resources.displayMetrics.density
    fun dp(v: Int) = (v * density).toInt()

    val bar = DraggableBar(service).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(dp(6), dp(8), dp(6), dp(8))
      background = GradientDrawable().apply {
        setColor(Color.parseColor("#E6208AEF"))
        cornerRadius = dp(24).toFloat()
      }
      elevation = dp(6).toFloat()
    }

    fun button(label: String, description: String, action: String): TextView =
      TextView(service).apply {
        text = label
        textSize = 22f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        contentDescription = description
        layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
        setOnClickListener { onAction(action) }
      }

    val counter = TextView(service).apply {
      text = status
      textSize = 13f
      setTextColor(Color.WHITE)
      typeface = android.graphics.Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      contentDescription = "Click count"
      layoutParams = LinearLayout.LayoutParams(dp(44), LinearLayout.LayoutParams.WRAP_CONTENT)
    }
    bar.addView(counter)

    val play = button(if (playing) "⏸" else "▶", "Start or pause", "toggle")
    val pick = button("◎", "Choose click points", "pick")
    val close = button("✕", "Close controls", "close")
    bar.addView(play)
    bar.addView(pick)
    bar.addView(close)

    val lp = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      if (!positioned) {
        lastX = service.resources.displayMetrics.widthPixels - dp(60)
        lastY = service.resources.displayMetrics.heightPixels / 3
        positioned = true
      }
      x = lastX
      y = lastY
    }

    bar.onDrag = { dx, dy ->
      lp.x += dx
      lp.y += dy
      lastX = lp.x
      lastY = lp.y
      runCatching { windowManager.updateViewLayout(bar, lp) }
    }

    windowManager.addView(bar, lp)
    root = bar
    playButton = play
    statusView = counter
    params = lp
  }

  fun setPlaying(playing: Boolean) {
    playButton?.text = if (playing) "⏸" else "▶"
  }

  /** Short text shown above the buttons, e.g. the number of clicks so far. */
  fun setStatus(text: String) {
    status = text
    statusView?.text = text
  }

  fun hide() {
    root?.let { runCatching { windowManager.removeView(it) } }
    root = null
    playButton = null
    statusView = null
    params = null
  }

  /** Lets child buttons receive clicks, but takes over once the finger moves: then it drags. */
  internal class DraggableBar(context: android.content.Context) : LinearLayout(context) {
    var onDrag: ((Int, Int) -> Unit)? = null
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var lastX = 0f
    private var lastY = 0f
    private var dragging = false

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
      when (ev.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = ev.rawX; downY = ev.rawY; lastX = ev.rawX; lastY = ev.rawY; dragging = false
        }
        MotionEvent.ACTION_MOVE -> {
          if (!dragging && (Math.abs(ev.rawX - downX) > slop || Math.abs(ev.rawY - downY) > slop)) {
            dragging = true
          }
        }
      }
      return dragging
    }

    override fun onTouchEvent(ev: MotionEvent): Boolean {
      when (ev.actionMasked) {
        MotionEvent.ACTION_MOVE -> {
          onDrag?.invoke((ev.rawX - lastX).toInt(), (ev.rawY - lastY).toInt())
          lastX = ev.rawX; lastY = ev.rawY
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> dragging = false
      }
      return true
    }
  }
}
