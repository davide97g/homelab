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
 * The focused app's cover, filling the framed panel behind the drum.
 *
 * Framed rather than full-bleed: inset from the bezel with a rounded corner. Two layers
 * crossfade, and whatever is showing drifts slowly, because a still image on a launcher
 * that is open for hours reads as a frozen screen. The cover is drawn from a small copy
 * scaled up, which is the blur: the sharp card in front is the object, this is its light.
 * A veil over it keeps light type legible on any picture.
 *
 * An app with no cover gets its own banner's dominant colour and its initial set huge
 * and faint — the same fallback its card uses.
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
    private var currentMark = ""
    private var previousMark = ""
    private val softened = java.util.WeakHashMap<Bitmap, Bitmap>()
    private val mark = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        typeface = androidx.core.content.res.ResourcesCompat.getFont(ctx, R.font.sora_light)
    }
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

    fun show(bitmap: Bitmap?, colour: Int, initial: String = "") {
        val soft = bitmap?.let { soften(it) }
        if (soft === current && colour == currentColour && initial == currentMark) return
        previous = current
        previousColour = currentColour
        previousMark = currentMark
        current = soft
        currentColour = colour
        currentMark = initial
        fade = 0f
        fader.cancel(); fader.start()
        if (!drifter.isStarted) drifter.start()
    }

    /** A 1/8 copy, drawn back up with bilinear filtering: a blur for the cost of a scale. */
    private fun soften(src: Bitmap): Bitmap = softened.getOrPut(src) {
        Bitmap.createScaledBitmap(src, (src.width / 8).coerceAtLeast(2), (src.height / 8).coerceAtLeast(2), true)
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

        drawLayer(canvas, previous, previousColour, previousMark, (1f - fade).coerceIn(0f, 1f))
        drawLayer(canvas, current, currentColour, currentMark, fade)

        // the veil: dark under the menu, open through the middle, dark under the copy,
        // and a vignette so the corners never fight the frame
        scrim.alpha = 255
        scrim.shader = LinearGradient(
            0f, frame.top, 0f, frame.bottom,
            intArrayOf(0x9E0A0706.toInt(), 0x380A0706, 0x4D0A0706, 0xE00A0706.toInt()),
            floatArrayOf(0f, .30f, .58f, 1f), Shader.TileMode.CLAMP,
        )
        canvas.drawRect(frame, scrim)
        scrim.shader = RadialGradient(
            frame.centerX(), frame.centerY(), (frame.width() * .62f).coerceAtLeast(1f),
            intArrayOf(0x000A0706, 0x000A0706, 0x8C0A0706.toInt()),
            floatArrayOf(0f, .5f, 1f), Shader.TileMode.CLAMP,
        )
        canvas.drawRect(frame, scrim)

        if (dim < 1f) {
            scrim.shader = null
            scrim.color = Ui.withAlpha(0xFF0A0706.toInt(), 1f - dim)
            canvas.drawRect(frame, scrim)
        }
        canvas.restore()

        // hairline, so the frame has an edge even against a dark photograph
        line.strokeWidth = Ui.px(this, 2f)
        line.color = 0x14FFFFFF
        canvas.drawRoundRect(frame, Ui.px(this, 34f), Ui.px(this, 34f), line)
    }

    private fun drawLayer(canvas: Canvas, bitmap: Bitmap?, colour: Int, initial: String, alpha: Float) {
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
            // the fallback every app without a cover gets: its own colour, lit from
            // the top left and falling to near-black, with its initial huge and faint
            scrim.alpha = 255
            scrim.shader = RadialGradient(
                frame.left + frame.width() * .22f, frame.top + frame.height() * .12f,
                (frame.height() * 1.35f).coerceAtLeast(1f),
                intArrayOf(
                    Ui.withAlpha(colour, .85f * alpha),
                    Ui.withAlpha(Ui.blend(colour, Color.BLACK, .55f), .95f * alpha),
                    Ui.withAlpha(0xFF0A0706.toInt(), alpha),
                ),
                floatArrayOf(0f, .55f, 1f), Shader.TileMode.CLAMP,
            )
            canvas.drawRect(frame, scrim)
            scrim.shader = null
            if (initial.isNotEmpty()) {
                mark.textSize = Ui.px(this, 900f)
                mark.alpha = (13 * alpha).toInt()
                canvas.drawText(initial, frame.centerX() - mark.measureText(initial) / 2f,
                    frame.centerY() + mark.textSize * .3f, mark)
            }
        }
    }
}
