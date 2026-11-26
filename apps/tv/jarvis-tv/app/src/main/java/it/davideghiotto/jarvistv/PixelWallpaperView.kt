package it.davideghiotto.jarvistv

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.util.AttributeSet
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView

/**
 * The desktop wallpaper: a pixel-art castle night, the same code as the browser
 * preview (`tv-preview/assets/private/desktop-hp.html`), run in the system WebView
 * from `assets/wallpaper/scene.html`. 480×270 art pixels, scaled ×4 with no smoothing.
 * The scene lives in src/private (git-ignored); without it the desktop is plain night blue.
 *
 * It never takes focus, so the D-pad stays on the dock, and it pauses its timers
 * whenever the launcher is not on screen.
 */
@SuppressLint("SetJavaScriptEnabled")
class PixelWallpaperView @JvmOverloads constructor(
    ctx: Context, attrs: AttributeSet? = null,
) : WebView(ctx, attrs) {

    init {
        setBackgroundColor(Color.parseColor("#151a42"))
        isFocusable = false
        isFocusableInTouchMode = false
        descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
        isVerticalScrollBarEnabled = false
        isHorizontalScrollBarEnabled = false
        overScrollMode = View.OVER_SCROLL_NEVER
        settings.javaScriptEnabled = true
        settings.allowFileAccess = true
        settings.mediaPlaybackRequiresUserGesture = true
        val present = runCatching { ctx.assets.list("wallpaper")?.contains("scene.html") == true }.getOrDefault(false)
        if (present) loadUrl("file:///android_asset/wallpaper/scene.html?fps=15")
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == VISIBLE) { onResume(); resumeTimers() } else { onPause() }
    }
}
