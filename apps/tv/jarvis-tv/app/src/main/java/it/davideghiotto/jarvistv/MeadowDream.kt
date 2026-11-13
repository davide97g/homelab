package it.davideghiotto.jarvistv

import android.animation.ValueAnimator
import android.graphics.BitmapFactory
import android.graphics.Color
import android.service.dreams.DreamService
import android.util.Log
import android.view.Gravity
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The screensaver: the painting, the hour, nothing else (tv-preview/studio.html,
 * "screensaver"). Any key wakes the set — that is DreamService's own behaviour.
 *
 * The painting is `assets/meadow.jpg` from src/private, which is git-ignored: it is
 * fine on our own TV but not ours to publish. Without it the dream is the plain cream
 * the painting fades to, with the clock on it.
 *
 * Selected over adb (deploy-tv.sh does it):
 *   settings put secure screensaver_components it.davideghiotto.jarvistv/.MeadowDream
 */
class MeadowDream : DreamService() {

    private val itLocale = Locale("it", "IT")
    private var drift: ValueAnimator? = null
    private val tick = object : Runnable {
        override fun run() { paint(); time?.postDelayed(this, 10_000) }
    }
    private var time: TextView? = null
    private var date: TextView? = null

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        isInteractive = false
        isFullscreen = true
        isScreenBright = true

        val sora = ResourcesCompat.getFont(this, R.font.sora)
        val root = FrameLayout(this).apply { setBackgroundColor(0xFFFBF7F2.toInt()) }

        val art = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
        runCatching { assets.open("meadow.jpg").use { BitmapFactory.decodeStream(it) } }
            .onSuccess { art.setImageBitmap(it) }
            .onFailure { Log.i("MeadowDream", "no meadow.jpg in assets, plain cream: $it") }
        root.addView(art, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))

        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        time = TextView(this).apply {
            typeface = ResourcesCompat.getFont(this@MeadowDream, R.font.sora_light)
            textSize = 84f
            letterSpacing = -.03f
            includeFontPadding = false
            setTextColor(0xFF1E1814.toInt())
            fontFeatureSettings = "tnum"
        }
        date = TextView(this).apply {
            typeface = sora
            textSize = 15f
            setTextColor(Color.argb(153, 30, 24, 20))
            setPadding(0, (resources.displayMetrics.density * 12).toInt(), 0, 0)
        }
        col.addView(time, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        col.addView(date, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT))
        root.addView(col, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM).apply {
            bottomMargin = (resources.displayMetrics.density * 50).toInt()
        })
        setContentView(root)

        // a 40 s push in and back, like the preview: a still picture for hours reads frozen
        drift = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 40_000
            repeatMode = ValueAnimator.REVERSE
            repeatCount = ValueAnimator.INFINITE
            addUpdateListener {
                val f = it.animatedValue as Float
                art.scaleX = 1.02f + .08f * f; art.scaleY = art.scaleX
                art.translationX = -art.width * .012f * f
                art.translationY = -art.height * .016f * f
            }
        }
    }

    override fun onDreamingStarted() {
        super.onDreamingStarted()
        paint()
        time?.postDelayed(tick, 10_000)
        drift?.start()
    }

    override fun onDreamingStopped() {
        super.onDreamingStopped()
        time?.removeCallbacks(tick)
        drift?.cancel()
    }

    private fun paint() {
        val now = Date()
        time?.text = SimpleDateFormat("HH:mm", itLocale).format(now)
        date?.text = SimpleDateFormat("EEEE d MMMM", itLocale).format(now)
    }
}
