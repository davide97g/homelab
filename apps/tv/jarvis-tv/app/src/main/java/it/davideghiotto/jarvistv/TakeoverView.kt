package it.davideghiotto.jarvistv

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.util.AttributeSet
import android.view.View
import android.view.animation.PathInterpolator

/**
 * Opening an app.
 *
 * The chosen card grows into the frame carrying its own artwork, and the sweep that was
 * running round its edge carries on round the whole screen while the activity starts.
 * One object travels, so there is never a frame showing neither the launcher nor the
 * app — and since a cold start on this set takes 300–900 ms, the animation *is* the
 * loading state rather than decoration over it.
 *
 * The rectangle is interpolated in [onDraw] rather than scaled with a transform: a card
 * and the frame are not the same aspect ratio, and a non-uniform scale would stretch
 * the corner radius and the ring with it.
 */
class TakeoverView @JvmOverloads constructor(
    ctx: Context, attrs: AttributeSet? = null, defStyle: Int = 0,
) : View(ctx, attrs, defStyle) {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val clip = Path()
    private val rect = RectF()
    private val from = RectF()
    private val to = RectF()
    private val src = Rect()
    private val dst = RectF()
    private val ease = PathInterpolator(.16f, 1f, .3f, 1f)

    private var art: Bitmap? = null
    private var icon: Drawable? = null
    private var accent = 0xFF4DE8F4.toInt()
    private var name = ""
    private var grow = 0f            // 0 = still the card, 1 = the whole frame
    private var contentAlpha = 0f
    private var sweepAngle = 0f
    private var barPhase = 0f

    private var spinner: ValueAnimator? = null

    fun open(cardRect: RectF, art: Bitmap?, icon: Drawable?, accent: Int, name: String) {
        this.art = art; this.icon = icon; this.accent = accent; this.name = name
        from.set(cardRect)
        val inset = Ui.px(this, 32f)
        to.set(inset, inset, width - inset, height - inset)
        grow = 0f; contentAlpha = 0f
        visibility = VISIBLE
        alpha = 1f

        // the sweep gets its own beat before the card starts growing, so the viewer
        // sees which card answered before the screen changes under them
        spinner?.cancel()
        spinner = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 1200
            repeatCount = ValueAnimator.INFINITE
            addUpdateListener {
                val f = it.animatedValue as Float
                sweepAngle = f * 360f
                barPhase = f
                invalidate()
            }
            start()
        }
        postDelayed({
            ValueAnimator.ofFloat(0f, 1f).apply {
                duration = 520
                interpolator = ease
                addUpdateListener { grow = it.animatedValue as Float; invalidate() }
                addListener(object : AnimatorListenerAdapter() {
                    override fun onAnimationEnd(animation: Animator) = fadeContent(1f)
                })
                start()
            }
        }, 420)
    }

    /** Exit at about 60 % of the entrance: that is what makes a reversal feel quick. */
    fun close(onEnd: () -> Unit) {
        fadeContent(0f)
        ValueAnimator.ofFloat(grow, 0f).apply {
            duration = 320
            interpolator = PathInterpolator(.4f, 0f, 1f, 1f)
            addUpdateListener { grow = it.animatedValue as Float; invalidate() }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    spinner?.cancel(); spinner = null
                    visibility = GONE
                    art = null; icon = null
                    onEnd()
                }
            })
            start()
        }
    }

    private fun fadeContent(target: Float) {
        ValueAnimator.ofFloat(contentAlpha, target).apply {
            duration = 260
            addUpdateListener { contentAlpha = it.animatedValue as Float; invalidate() }
            start()
        }
    }

    override fun onDraw(canvas: Canvas) {
        // A launcher must not die in a draw call. The card rectangle arrives from a
        // RecyclerView row, which can be zero-sized for a frame, and a RadialGradient
        // with a radius of 0 throws — that took the whole launcher down once.
        if (visibility != VISIBLE || width == 0 || height == 0) return
        if (from.width() <= 0f || from.height() <= 0f) return
        val t = ease.getInterpolation(grow.coerceIn(0f, 1f))
        rect.set(
            Ui.lerp(from.left, to.left, t), Ui.lerp(from.top, to.top, t),
            Ui.lerp(from.right, to.right, t), Ui.lerp(from.bottom, to.bottom, t),
        )
        val radius = Ui.lerp(Ui.px(this, 22f), Ui.px(this, 34f), t)

        clip.rewind()
        clip.addRoundRect(rect, radius, radius, Path.Direction.CW)
        canvas.save()
        canvas.clipPath(clip)

        val bmp = art
        if (bmp != null && !bmp.isRecycled) {
            // keeps pushing in while the app starts, so the screen is never frozen
            val zoom = 1.02f + .06f * t
            val scale = maxOf(rect.width() / bmp.width, rect.height() / bmp.height) * zoom
            val w = bmp.width * scale; val h = bmp.height * scale
            src.set(0, 0, bmp.width, bmp.height)
            dst.set(
                rect.centerX() - w / 2f, rect.centerY() - h / 2f,
                rect.centerX() + w / 2f, rect.centerY() + h / 2f,
            )
            canvas.drawBitmap(bmp, src, dst, paint)
        } else {
            paint.shader = RadialGradient(
                rect.centerX(), rect.centerY(), (rect.width() * .7f).coerceAtLeast(1f),
                Ui.blend(accent, Color.BLACK, .3f), Ui.blend(accent, Color.BLACK, .85f),
                Shader.TileMode.CLAMP,
            )
            canvas.drawRect(rect, paint)
            paint.shader = null
        }

        paint.shader = RadialGradient(
            rect.centerX(), rect.centerY(), (maxOf(rect.width(), rect.height()) * .7f).coerceAtLeast(1f),
            0x8C050810.toInt(), 0xDB050810.toInt(), Shader.TileMode.CLAMP,
        )
        canvas.drawRect(rect, paint)
        paint.shader = null

        if (contentAlpha > .01f) drawContent(canvas)
        canvas.restore()

        Sweep.draw(canvas, rect, radius, Ui.px(this, 4f), accent, sweepAngle, alpha = t, base = .35f)
    }

    private fun drawContent(canvas: Canvas) {
        val cx = rect.centerX()
        val cy = rect.centerY()
        val a = contentAlpha

        val tile = Ui.px(this, 116f)
        paint.color = Ui.withAlpha(Color.WHITE, .12f * a)
        canvas.drawRoundRect(
            cx - tile / 2, cy - tile - Ui.px(this, 40f), cx + tile / 2, cy - Ui.px(this, 40f),
            Ui.px(this, 32f), Ui.px(this, 32f), paint,
        )
        icon?.let {
            val pad = Ui.px(this, 24f)
            it.alpha = (a * 255).toInt()
            it.setBounds(
                (cx - tile / 2 + pad).toInt(), (cy - tile - Ui.px(this, 40f) + pad).toInt(),
                (cx + tile / 2 - pad).toInt(), (cy - Ui.px(this, 40f) - pad).toInt(),
            )
            it.draw(canvas)
            it.alpha = 255
        }

        text.typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
        text.textSize = Ui.px(this, 46f)
        text.color = Ui.withAlpha(Color.WHITE, a)
        canvas.drawText(name, cx - text.measureText(name) / 2f, cy + Ui.px(this, 18f), text)

        text.typeface = Typeface.DEFAULT
        text.textSize = Ui.px(this, 17f)
        text.letterSpacing = .2f
        text.color = Ui.withAlpha(Color.WHITE, .45f * a)
        val hint = context.getString(R.string.opening)
        canvas.drawText(hint, cx - text.measureText(hint) / 2f, cy + Ui.px(this, 58f), text)
        text.letterSpacing = 0f

        // indeterminate: the launcher cannot know how long the app will take
        val barW = Ui.px(this, 280f)
        val barY = cy + Ui.px(this, 100f)
        val h = Ui.px(this, 3f)
        paint.color = Ui.withAlpha(Color.WHITE, .16f * a)
        canvas.drawRoundRect(cx - barW / 2, barY, cx + barW / 2, barY + h, h, h, paint)
        val chunk = barW * .4f
        val x = cx - barW / 2 - chunk + (barW + chunk) * barPhase
        paint.color = Ui.withAlpha(accent, a)
        canvas.save()
        canvas.clipRect(cx - barW / 2, barY, cx + barW / 2, barY + h)
        canvas.drawRoundRect(x, barY, x + chunk, barY + h, h, h, paint)
        canvas.restore()
    }
}
