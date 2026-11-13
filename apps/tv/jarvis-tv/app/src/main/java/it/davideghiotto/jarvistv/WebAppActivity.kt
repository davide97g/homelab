package it.davideghiotto.jarvistv

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlin.math.min

/**
 * One site, full screen: Chrome's engine (the system WebView) with no address bar,
 * no tabs, nothing but the page.
 *
 * The remote drives a pointer, as TV browsers do, because most sites are made for a
 * mouse or a finger rather than a D-pad:
 *  - arrows move it, faster the longer they are held
 *  - pushing against an edge scrolls whatever is under it (the page, or the inner
 *    panel the pointer is over)
 *  - OK taps where it points; a text field brings up the TV keyboard
 *  - BACK goes back a page, then out to the dock
 *  - MENU turns the pointer off and hands the arrows to the page, for sites that
 *    already work with a D-pad; MENU again brings it back
 *  - play/pause toggles the video on the page
 *
 * The pointer fades after a few still seconds so a video plays clean.
 *
 * Cookies and storage persist, so a login survives. Sign-in with Google will not
 * work here: Google refuses embedded WebViews by design.
 */
class WebAppActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_NAME = "name"
        private const val TAG = "WebApp"

        /** Scroll the scrollable thing under (x, y) — device px — or the page. */
        private const val SCROLL_JS = """
(function(x,y,dx,dy){
  var r=window.devicePixelRatio||1; x/=r; y/=r;
  var el=document.elementFromPoint(x,y);
  while(el&&el!==document.body&&el!==document.documentElement){
    var s=getComputedStyle(el);
    if((dy&&/(auto|scroll)/.test(s.overflowY)&&el.scrollHeight>el.clientHeight)||
       (dx&&/(auto|scroll)/.test(s.overflowX)&&el.scrollWidth>el.clientWidth)){el.scrollBy(dx,dy);return;}
    el=el.parentElement;
  }
  window.scrollBy(dx,dy);
})"""

        private const val PLAY_PAUSE_JS =
            "(function(){var v=document.querySelector('video');if(v){v.paused?v.play():v.pause();}})()"
    }

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var cursor: CursorView
    private lateinit var progress: ProgressBar
    private var fullscreen: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var pointer = true

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }

        web = WebView(this)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            setSupportZoom(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            // drop the "; wv" token: some sites serve a broken page to anything that
            // admits to being an embedded WebView
            userAgentString = userAgentString.replace("; wv", "")
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                val scheme = req.url.scheme ?: return false
                if (scheme == "http" || scheme == "https" || scheme == "about" || scheme == "data") return false
                // intent:, market:, mailto: and the like: hand them to the system if
                // anything on the TV takes them, otherwise ignore rather than error
                runCatching {
                    val intent = if (scheme == "intent") Intent.parseUri(req.url.toString(), Intent.URI_INTENT_SCHEME)
                    else Intent(Intent.ACTION_VIEW, req.url)
                    startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }.onFailure { Log.i(TAG, "nothing handles $scheme: link") }
                return true
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                progress.progress = newProgress
                progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
            }

            // fullscreen video: the player's own view takes over the screen
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                fullscreen?.let { onHideCustomView() }
                fullscreen = view
                fullscreenCallback = callback
                root.addView(view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
                cursor.bringToFront()
                web.visibility = View.INVISIBLE
            }

            override fun onHideCustomView() {
                fullscreen?.let { root.removeView(it) }
                fullscreen = null
                fullscreenCallback?.onCustomViewHidden()
                fullscreenCallback = null
                web.visibility = View.VISIBLE
            }

            // DRM for video sites; camera and microphone are never granted (the set has neither)
            override fun onPermissionRequest(request: PermissionRequest) {
                val drm = request.resources.filter { it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }
                if (drm.isNotEmpty()) request.grant(drm.toTypedArray()) else request.deny()
            }
        }

        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            progressTintList = android.content.res.ColorStateList.valueOf(0xFF4DE8F4.toInt())
            visibility = View.GONE
        }
        cursor = CursorView(this, ::scrollAt)

        root.addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        root.addView(progress, FrameLayout.LayoutParams(MATCH_PARENT, Ui.px(this, 6f).toInt()))
        root.addView(cursor, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setContentView(root)

        load(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        load(intent)
    }

    private fun load(intent: Intent?) {
        val url = intent?.getStringExtra(EXTRA_URL) ?: return finish()
        val scheme = Uri.parse(url).scheme
        if (scheme != "http" && scheme != "https") return finish()
        if (web.url?.trimEnd('/') == url.trimEnd('/')) return
        web.loadUrl(url)
        cursor.home()
    }

    override fun onResume() { super.onResume(); web.onResume() }

    override fun onPause() {
        super.onPause()
        web.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onDestroy() {
        cursor.stop()
        web.destroy()
        super.onDestroy()
    }

    // ── keys ─────────────────────────────────────────────────────────────────────

    private fun dir(code: Int) = when (code) {
        KeyEvent.KEYCODE_DPAD_LEFT -> -1 to 0
        KeyEvent.KEYCODE_DPAD_RIGHT -> 1 to 0
        KeyEvent.KEYCODE_DPAD_UP -> 0 to -1
        KeyEvent.KEYCODE_DPAD_DOWN -> 0 to 1
        else -> null
    }

    private val isOk = { code: Int -> code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        val code = e.keyCode
        val down = e.action == KeyEvent.ACTION_DOWN

        if (code == KeyEvent.KEYCODE_BACK) {
            if (!down) return true
            when {
                fullscreen != null -> web.webChromeClient?.onHideCustomView()
                web.canGoBack() -> web.goBack()
                else -> finish()
            }
            return true
        }
        if (code == KeyEvent.KEYCODE_MENU) {
            if (down && e.repeatCount == 0) {
                pointer = !pointer
                cursor.active = pointer
                Toast.makeText(this,
                    if (pointer) R.string.web_pointer_on else R.string.web_pointer_off, Toast.LENGTH_SHORT).show()
            }
            return true
        }
        if (code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || code == KeyEvent.KEYCODE_MEDIA_PLAY || code == KeyEvent.KEYCODE_MEDIA_PAUSE) {
            if (down && e.repeatCount == 0) web.evaluateJavascript(PLAY_PAUSE_JS, null)
            return true
        }
        // a text field has the keyboard: the arrows belong to it
        if (!pointer || isKeyboardUp()) return super.dispatchKeyEvent(e)

        dir(code)?.let { (dx, dy) ->
            if (down) cursor.press(dx, dy) else cursor.release(dx, dy)
            return true
        }
        if (isOk(code)) {
            if (down && e.repeatCount == 0) tap()
            return true
        }
        return super.dispatchKeyEvent(e)
    }

    private fun isKeyboardUp(): Boolean {
        val r = android.graphics.Rect()
        root.getWindowVisibleDisplayFrame(r)
        return root.rootView.height - r.bottom > root.rootView.height * .2f
    }

    /** A finger tap where the pointer is, delivered to whatever is on top. */
    private fun tap() {
        cursor.wake()
        cursor.click()
        val target: View = fullscreen ?: web
        val loc = IntArray(2).also { target.getLocationOnScreen(it) }
        val rootLoc = IntArray(2).also { root.getLocationOnScreen(it) }
        val x = cursor.cx - (loc[0] - rootLoc[0])
        val y = cursor.cy - (loc[1] - rootLoc[1])
        val t = SystemClock.uptimeMillis()
        fun ev(action: Int, at: Long) = MotionEvent.obtain(t, at, action, x, y, 0).apply {
            source = InputDevice.SOURCE_TOUCHSCREEN
        }
        ev(MotionEvent.ACTION_DOWN, t).also { target.dispatchTouchEvent(it); it.recycle() }
        target.postDelayed({
            ev(MotionEvent.ACTION_UP, t + 60).also { target.dispatchTouchEvent(it); it.recycle() }
        }, 60)
    }

    private fun scrollAt(x: Float, y: Float, dx: Float, dy: Float) {
        if (fullscreen != null) return
        web.evaluateJavascript("$SCROLL_JS($x,$y,$dx,$dy)", null)
    }
}

/**
 * The pointer: a macOS-style arrow that the arrows move with acceleration, and that
 * scrolls what is under it when pushed against an edge.
 */
@SuppressLint("ViewConstructor")
class CursorView(ctx: Context, private val onScroll: (Float, Float, Float, Float) -> Unit) : View(ctx) {

    var cx = 0f; private set
    var cy = 0f; private set

    var active = true
        set(v) { field = v; if (!v) { held.clear() }; wake() }

    private val held = mutableSetOf<Pair<Int, Int>>()
    private var heldSince = 0L
    private var lastFrame = 0L
    private var lastMove = SystemClock.uptimeMillis()
    private var clickAt = 0L
    private var running = false

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val edge = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.BLACK; style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND
    }
    private val arrow = Path()

    init { setWillNotDraw(false) }

    fun home() { cx = width / 2f; cy = height / 2f; wake() }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        if (cx == 0f && cy == 0f) { cx = w / 2f; cy = h / 2f }
        val s = Ui.px(this, 1.6f)
        arrow.rewind()
        // the classic pointer, tip at (0, 0)
        arrow.moveTo(0f, 0f)
        arrow.lineTo(0f, 17f * s)
        arrow.lineTo(4.2f * s, 13.2f * s)
        arrow.lineTo(7f * s, 19.5f * s)
        arrow.lineTo(9.6f * s, 18.4f * s)
        arrow.lineTo(6.8f * s, 12.2f * s)
        arrow.lineTo(12.2f * s, 12.2f * s)
        arrow.close()
        edge.strokeWidth = 1.4f * s
    }

    fun press(dx: Int, dy: Int) {
        if (held.isEmpty()) heldSince = SystemClock.uptimeMillis()
        held += dx to dy
        wake()
    }

    fun release(dx: Int, dy: Int) { held -= dx to dy }

    fun click() { clickAt = SystemClock.uptimeMillis(); wake() }

    fun wake() {
        lastMove = SystemClock.uptimeMillis()
        if (!running) { running = true; lastFrame = 0L; postInvalidateOnAnimation() }
    }

    fun stop() { running = false; held.clear() }

    override fun onDraw(canvas: Canvas) {
        val now = SystemClock.uptimeMillis()
        val dt = if (lastFrame == 0L) 16f else (now - lastFrame).toFloat().coerceAtMost(50f)
        lastFrame = now

        if (held.isNotEmpty() && active) {
            // 0.35 px/ms to start, ramping to 1.6 px/ms over a second of holding
            val ramp = ((now - heldSince) / 1000f).coerceIn(0f, 1f)
            val speed = Ui.px(this, .7f + 2.5f * ramp * ramp) * dt
            val dx = held.sumOf { it.first }.toFloat() * speed
            val dy = held.sumOf { it.second }.toFloat() * speed
            val nx = cx + dx; val ny = cy + dy
            val m = Ui.px(this, 4f)
            cx = nx.coerceIn(m, width - m)
            cy = ny.coerceIn(m, height - m)
            // pushing past an edge scrolls instead
            val sx = if (nx != cx) dx * 1.8f else 0f
            val sy = if (ny != cy) dy * 1.8f else 0f
            if (sx != 0f || sy != 0f) onScroll(cx, cy, sx, sy)
            lastMove = now
        }

        val idle = now - lastMove
        val alpha = when {
            !active -> 0f
            idle < 3000 -> 1f
            else -> (1f - (idle - 3000) / 500f).coerceIn(0f, 1f)
        }
        if (alpha > 0f) {
            val press = min(1f, (now - clickAt) / 160f)
            val scale = .82f + .18f * press
            canvas.save()
            canvas.translate(cx, cy)
            canvas.scale(scale, scale)
            fill.alpha = (255 * alpha).toInt()
            edge.alpha = (255 * alpha).toInt()
            canvas.drawPath(arrow, fill)
            canvas.drawPath(arrow, edge)
            canvas.restore()
        }

        if (running && (held.isNotEmpty() || alpha > 0f || now - clickAt < 200)) postInvalidateOnAnimation()
        else running = false
    }
}
