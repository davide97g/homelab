package it.davideghiotto.jarvistv

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.os.SystemClock
import android.util.AttributeSet
import android.util.Log
import android.view.View
import android.view.animation.PathInterpolator
import kotlin.math.PI
import kotlin.math.sin
import kotlin.random.Random

/**
 * The desktop: a painting full-bleed behind everything, kept just barely alive.
 *
 * `assets/wallpaper.jpg` is the lily pond seen from under the water (generated for
 * this, see src/private/README.md); the screensaver's meadow is the fallback, cream
 * the last. Over it, all drawn here and cheap enough for a 2 GB set:
 *  - bubbles rise from the deep, wobbling, and fade out at the surface
 *  - the sun's glow breathes, slowly
 *  - a few bokeh dots of light twinkle where the sun breaks through
 *  - the painting itself drifts, a 60 s push in and back
 *
 * The bubbles only run while the view is on screen and undimmed; on the JARVIS
 * screen the veil covers it and the frame loop stops.
 */
class WallpaperView @JvmOverloads constructor(
    ctx: Context, attrs: AttributeSet? = null,
) : View(ctx, attrs) {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val veil = Paint()
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = PorterDuffXfermode(PorterDuff.Mode.SCREEN)
    }
    private val src = Rect()
    private val dst = RectF()
    private val oval = RectF()

    private val art: Bitmap? = load(ctx, "wallpaper.jpg") ?: load(ctx, "meadow.jpg")
    /** Where the light breaks through in the painting, as fractions of the frame. */
    private val sunX = .45f
    private val sunY = .34f

    private var drift = 0f
    private var shade = 0f
    private var lastFrame = 0L

    private val drifter = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 60_000
        repeatMode = ValueAnimator.REVERSE
        repeatCount = ValueAnimator.INFINITE
        interpolator = PathInterpolator(.45f, 0f, .55f, 1f)
        addUpdateListener { drift = it.animatedValue as Float }
    }
    private val shader = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 560
        interpolator = PathInterpolator(.16f, 1f, .3f, 1f)
        addUpdateListener { shade = it.animatedValue as Float; invalidate() }
    }

    /** 1 on the desktop; near 0 once the orb has the screen, which wants the dark. */
    var dim = 1f
        set(value) {
            if (field == value) return
            field = value
            shader.cancel()
            shader.setFloatValues(shade, 1f - value)
            shader.start()
            invalidate()
        }

    // ── particles ─────────────────────────────────────────────────────────────────

    private class Bubble {
        var x = 0f; var y = 0f; var r = 0f
        var speed = 0f; var phase = 0f; var wobble = 0f; var top = 0f; var life = 0f
    }

    private class Mote {
        var x = 0f; var y = 0f; var r = 0f; var phase = 0f; var period = 0f; var colour = 0
    }

    private val rnd = Random(7)
    private val bubbles = List(22) { Bubble() }
    private val motes = List(14) { Mote() }
    private var seeded = false
    private val moteColours = intArrayOf(
        0xFFFFF3A0.toInt(), 0xFFFFC7A6.toInt(), 0xFFFFFFFF.toInt(), 0xFFF8B8D8.toInt(), 0xFFE9FF9E.toInt(),
    )

    private fun respawn(b: Bubble, anywhere: Boolean) {
        b.r = Ui.px(this, 5f + rnd.nextFloat() * rnd.nextFloat() * 22f)
        b.x = width * (.03f + rnd.nextFloat() * .94f)
        b.y = if (anywhere) height * (.3f + rnd.nextFloat() * .7f) else height + b.r * 2 + rnd.nextFloat() * height * .25f
        // big bubbles rise faster, as they do
        b.speed = Ui.px(this, 22f + b.r / Ui.px(this, 1f) * 2.2f + rnd.nextFloat() * 14f)
        b.phase = rnd.nextFloat() * 2 * PI.toFloat()
        b.wobble = Ui.px(this, 4f + rnd.nextFloat() * 10f)
        // they break at the surface, which in the painting is the band of pads
        b.top = height * (.18f + rnd.nextFloat() * .3f)
        b.life = 0f
    }

    private fun seed() {
        bubbles.forEach { respawn(it, anywhere = true) }
        motes.forEach { m ->
            val a = rnd.nextFloat() * 2 * PI.toFloat()
            val d = rnd.nextFloat()
            m.x = width * (sunX + kotlin.math.cos(a) * d * .22f)
            m.y = height * (sunY + sin(a) * d * .22f - .05f)
            m.r = Ui.px(this, 4f + rnd.nextFloat() * 9f)
            m.phase = rnd.nextFloat()
            m.period = 3f + rnd.nextFloat() * 5f
            m.colour = moteColours[rnd.nextInt(moteColours.size)]
        }
        seeded = true
    }

    private val running get() = isShown && windowVisibility == VISIBLE && shade < .9f

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (art != null) drifter.start()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        drifter.cancel(); shader.cancel()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == VISIBLE) { lastFrame = 0L; if (art != null && !drifter.isStarted) drifter.start(); invalidate() }
        else drifter.pause()
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        if (w > 0 && h > 0) seed()
    }

    override fun onDraw(canvas: Canvas) {
        if (width == 0 || height == 0) return
        if (!seeded) seed()
        val now = SystemClock.uptimeMillis()
        val dt = if (lastFrame == 0L) 0f else ((now - lastFrame) / 1000f).coerceAtMost(.1f)
        lastFrame = now
        val t = now / 1000f

        canvas.drawColor(0xFFFBF7F2.toInt())
        val bmp = art
        if (bmp != null) {
            val zoom = 1.03f + .04f * drift
            val scale = maxOf(width / bmp.width.toFloat(), height / bmp.height.toFloat()) * zoom
            val w = bmp.width * scale; val h = bmp.height * scale
            val dx = (width - w) / 2f - width * .008f * drift
            val dy = (height - h) / 2f - height * .01f * drift
            src.set(0, 0, bmp.width, bmp.height)
            dst.set(dx, dy, dx + w, dy + h)
            canvas.drawBitmap(bmp, src, dst, paint)
        }

        drawSun(canvas, t)
        drawMotes(canvas, t)
        drawBubbles(canvas, dt, t)

        if (shade > 0.001f) {
            veil.color = Ui.withAlpha(0xFF05080C.toInt(), shade)
            canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), veil)
        }

        if (running) postInvalidateOnAnimation()
    }

    /** The light breaking through breathes: an 11 s swell, never more than a lift. */
    private fun drawSun(canvas: Canvas, t: Float) {
        val breath = .5f + .5f * sin(t * 2 * PI.toFloat() / 11f)
        val cx = width * sunX; val cy = height * sunY
        val r = width * (.22f + .03f * breath)
        glow.shader = RadialGradient(cx, cy, r,
            intArrayOf(Color.argb((70 + 50 * breath).toInt(), 255, 250, 215), Color.argb((25 * breath).toInt(), 255, 236, 200), 0),
            floatArrayOf(0f, .45f, 1f), Shader.TileMode.CLAMP)
        canvas.drawCircle(cx, cy, r, glow)
        glow.shader = null
    }

    private fun drawMotes(canvas: Canvas, t: Float) {
        motes.forEach { m ->
            val k = ((t / m.period + m.phase) % 1f)
            val a = sin(k * PI.toFloat())                      // in and out once per period
            if (a <= .02f) return@forEach
            val r = m.r * (.7f + .3f * a)
            glow.shader = RadialGradient(m.x, m.y, r,
                intArrayOf(Ui.withAlpha(m.colour, .85f * a), Ui.withAlpha(m.colour, .35f * a), 0),
                floatArrayOf(0f, .55f, 1f), Shader.TileMode.CLAMP)
            canvas.drawCircle(m.x, m.y, r, glow)
        }
        glow.shader = null
    }

    /** A painted bubble: a soft fill, a white rim, and a highlight up and to the left. */
    private fun drawBubbles(canvas: Canvas, dt: Float, t: Float) {
        bubbles.forEach { b ->
            b.y -= b.speed * dt
            b.life += dt
            if (b.y < b.top) { respawn(b, anywhere = false); return@forEach }
            val x = b.x + sin(t * 1.3f + b.phase) * b.wobble
            // fade in from the deep, out as it nears the surface
            val fadeIn = (b.life / 1.5f).coerceIn(0f, 1f)
            val fadeOut = ((b.y - b.top) / (height * .12f)).coerceIn(0f, 1f)
            val a = fadeIn * fadeOut
            if (a <= .01f) return@forEach

            fill.color = Color.argb((38 * a).toInt(), 230, 255, 250)
            canvas.drawCircle(x, b.y, b.r, fill)
            ring.strokeWidth = (b.r * .14f).coerceAtLeast(Ui.px(this, 1.5f))
            ring.color = Color.argb((175 * a).toInt(), 255, 255, 255)
            canvas.drawCircle(x, b.y, b.r, ring)
            ring.strokeWidth = (b.r * .16f).coerceAtLeast(Ui.px(this, 1.5f))
            ring.color = Color.argb((230 * a).toInt(), 255, 255, 255)
            val hr = b.r * .62f
            oval.set(x - hr, b.y - hr, x + hr, b.y + hr)
            canvas.drawArc(oval, 200f, 55f, false, ring)
            fill.color = Color.argb((235 * a).toInt(), 255, 255, 255)
            canvas.drawCircle(x + b.r * .38f, b.y + b.r * .4f, b.r * .1f, fill)
        }
    }

    private companion object {
        /** Decoded no larger than the screen: the 4K file is subsampled, never held whole. */
        fun load(ctx: Context, name: String): Bitmap? = runCatching {
            val screen = ctx.resources.displayMetrics.widthPixels.coerceAtLeast(1280)
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            ctx.assets.open(name).use { BitmapFactory.decodeStream(it, null, bounds) }
            var sample = 1
            while (bounds.outWidth / (sample * 2) >= screen) sample *= 2
            ctx.assets.open(name).use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply {
                    inSampleSize = sample
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                })
            }
        }.onFailure { Log.i("Wallpaper", "no $name: $it") }.getOrNull()
    }
}
