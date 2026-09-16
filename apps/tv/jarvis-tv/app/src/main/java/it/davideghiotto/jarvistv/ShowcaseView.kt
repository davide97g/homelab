package it.davideghiotto.jarvistv

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import android.view.animation.PathInterpolator

/**
 * The picture behind the app rail.
 *
 * It is framed rather than full-bleed: inset from the bezel with a rounded corner, so
 * the dark margin gives the type a quiet edge to start from and the panel's backlight
 * bloom stays off the photograph. Two layers crossfade, and whatever is showing drifts
 * slowly, because a still image on a launcher that is open for hours reads as a frozen
 * screen.
 *
 * An app with no artwork gets a gradient built from its own banner's dominant colour,
 * which is the fallback the whole design is drawn around.
 */
class ShowcaseView @JvmOverloads constructor(
    ctx: Context, attrs: AttributeSet? = null, defStyle: Int = 0,
) : View(ctx, attrs, defStyle) {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
        // the photograph is the background, not the subject: a stop down and slightly
        // desaturated, so white type over it never has to fight the picture
        colorFilter = android.graphics.ColorMatrixColorFilter(
            android.graphics.ColorMatrix().apply {
                setSaturation(.92f)
                postConcat(android.graphics.ColorMatrix(floatArrayOf(
                    .82f, 0f, 0f, 0f, 0f,
                    0f, .82f, 0f, 0f, 0f,
                    0f, 0f, .82f, 0f, 0f,
                    0f, 0f, 0f, 1f, 0f,
                )))
            }
        )
    }
    private val scrim = Paint(Paint.ANTI_ALIAS_FLAG)
    // its own paint: a Paint's alpha multiplies whatever shader it carries, so drawing
    // the hairline with the scrim's paint quietly dims every gradient on the next frame
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val clip = Path()
    private val frame = RectF()
    private val src = Rect()
    private val dst = RectF()

    private var current: Bitmap? = null
    private var previous: Bitmap? = null
    private var currentColour = 0xFF14202C.toInt()
    private var previousColour = currentColour
    private var fade = 1f
    private var drift = 0f

    /** 1 on the apps screen, near 0 once the orb has the frame. */
    var dim = 1f
        set(value) { field = value; invalidate() }

    private val fader = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 620
        interpolator = PathInterpolator(.16f, 1f, .3f, 1f)
        addUpdateListener { fade = it.animatedValue as Float; invalidate() }
    }

    // ~26 s for one pass of the drift, matching the preview's Ken Burns
    private val drifter = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 26_000
        repeatMode = ValueAnimator.REVERSE
        repeatCount = ValueAnimator.INFINITE
        addUpdateListener { drift = it.animatedValue as Float; invalidate() }
    }

    fun show(bitmap: Bitmap?, colour: Int) {
        if (bitmap === current && colour == currentColour) return
        previous = current
        previousColour = currentColour
        current = bitmap
        currentColour = colour
        fade = 0f
        fader.cancel(); fader.start()
        if (!drifter.isStarted) drifter.start()
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        fader.cancel(); drifter.cancel()
    }

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        val inset = Ui.px(this, 32f)
        frame.set(inset, inset, w - inset, h - inset)
        clip.rewind()
        clip.addRoundRect(frame, Ui.px(this, 34f), Ui.px(this, 34f), Path.Direction.CW)
    }

    override fun onDraw(canvas: Canvas) {
        canvas.save()
        canvas.clipPath(clip)

        drawLayer(canvas, previous, previousColour, (1f - fade).coerceIn(0f, 1f))
        drawLayer(canvas, current, currentColour, fade)

        // the scrims: dark from the left for the hero, dark from the bottom for the
        // rail, a touch from the top for the clock
        scrim.alpha = 255
        scrim.shader = LinearGradient(
            frame.left, 0f, frame.right, 0f,
            intArrayOf(0xF0050810.toInt(), 0xB8050810.toInt(), 0x1F050810, 0x73050810),
            floatArrayOf(0f, .34f, .62f, 1f), Shader.TileMode.CLAMP,
        )
        canvas.drawRect(frame, scrim)
        scrim.shader = LinearGradient(
            0f, frame.bottom, 0f, frame.top,
            intArrayOf(0xF5050810.toInt(), 0x59050810, 0x00050810),
            floatArrayOf(0f, .34f, .62f), Shader.TileMode.CLAMP,
        )
        canvas.drawRect(frame, scrim)

        if (dim < 1f) {
            scrim.shader = null
            scrim.color = Ui.withAlpha(0xFF05080C.toInt(), 1f - dim)
            canvas.drawRect(frame, scrim)
        }
        canvas.restore()

        // hairline, so the frame has an edge even against a dark photograph
        line.strokeWidth = Ui.px(this, 2f)
        line.color = 0x14FFFFFF
        canvas.drawRoundRect(frame, Ui.px(this, 34f), Ui.px(this, 34f), line)
    }

    private fun drawLayer(canvas: Canvas, bitmap: Bitmap?, colour: Int, alpha: Float) {
        if (alpha <= 0.001f) return
        if (bitmap != null && !bitmap.isRecycled) {
            // cover, with the slow push the drift animator provides
            val zoom = 1.05f + .09f * drift
            val scale = maxOf(frame.width() / bitmap.width, frame.height() / bitmap.height) * zoom
            val w = bitmap.width * scale
            val h = bitmap.height * scale
            val dx = (frame.width() - w) / 2f - (w - frame.width()) * .06f * drift
            val dy = (frame.height() - h) / 2f - (h - frame.height()) * .08f * drift
            src.set(0, 0, bitmap.width, bitmap.height)
            dst.set(frame.left + dx, frame.top + dy, frame.left + dx + w, frame.top + dy + h)
            paint.alpha = (alpha * 255).toInt()
            canvas.drawBitmap(bitmap, src, dst, paint)
            paint.alpha = 255
        } else {
            // the fallback every app without artwork gets: its own colour, lit from
            // the top left and falling to near-black
            scrim.alpha = 255
            scrim.shader = RadialGradient(
                frame.left + frame.width() * .22f, frame.top + frame.height() * .12f,
                (frame.height() * 1.35f).coerceAtLeast(1f),
                intArrayOf(
                    Ui.withAlpha(colour, .85f * alpha),
                    Ui.withAlpha(Ui.blend(colour, Color.BLACK, .55f), .95f * alpha),
                    Ui.withAlpha(0xFF05080C.toInt(), alpha),
                ),
                floatArrayOf(0f, .55f, 1f), Shader.TileMode.CLAMP,
            )
            canvas.drawRect(frame, scrim)
        }
    }
}
