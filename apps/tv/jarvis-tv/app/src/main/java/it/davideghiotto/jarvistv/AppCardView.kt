package it.davideghiotto.jarvistv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Drawable
import android.util.AttributeSet
import android.view.View

/**
 * One app on the rail: its own artwork, its name, and — when the server knows the
 * viewer is part way through something — a resume bar.
 *
 * The artwork is whatever the TV itself has: the leanback banner every Android TV app
 * ships, and for Jellyfin the backdrop of the film being resumed, fetched through the
 * server. A still is small at this size, so it is pushed a stop brighter and more
 * saturated and zoomed slightly; the bottom of the card is scrimmed deeply enough to
 * carry white text whatever the picture does there.
 */
class AppCardView @JvmOverloads constructor(
    ctx: Context, attrs: AttributeSet? = null, defStyle: Int = 0,
) : View(ctx, attrs, defStyle) {

    var art: Bitmap? = null
        set(value) { field = value; invalidate() }
    var icon: Drawable? = null
        set(value) { field = value; invalidate() }
    var label: String = ""
        set(value) { field = value; invalidate() }
    var accent: Int = 0xFF4DE8F4.toInt()
        set(value) { field = value; invalidate() }
    /** 0 when there is nothing to resume. */
    var progress: Float = 0f
        set(value) { field = value; invalidate() }
    var badge: String? = null
        set(value) { field = value; invalidate() }

    var picked = false
        set(value) {
            if (field == value) return
            field = value
            invalidate()
        }

    /** Set by the rail while the sweep runs; degrees. */
    var sweepAngle = 0f
        set(value) { field = value; if (picked) invalidate() }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
    }
    private val clipPath = Path()
    private val bounds = RectF()
    private val ring = RectF()
    private val src = Rect()
    private val dst = RectF()

    private val lively = ColorMatrixColorFilter(ColorMatrix().apply {
        setSaturation(1.2f)
        postConcat(ColorMatrix(floatArrayOf(
            1.12f, 0f, 0f, 0f, 6f,
            0f, 1.12f, 0f, 0f, 6f,
            0f, 0f, 1.12f, 0f, 6f,
            0f, 0f, 0f, 1f, 0f,
        )))
    })

    private val radius get() = Ui.px(this, 22f)

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        bounds.set(0f, 0f, w.toFloat(), h.toFloat())
        val inset = Ui.px(this, 1f)
        ring.set(inset, inset, w - inset, h - inset)
        clipPath.rewind()
        clipPath.addRoundRect(bounds, radius, radius, Path.Direction.CW)
    }

    override fun onDraw(canvas: Canvas) {
        canvas.save()
        canvas.clipPath(clipPath)

        val bmp = art
        if (bmp != null && !bmp.isRecycled) {
            val zoom = 1.12f
            val scale = maxOf(width / bmp.width.toFloat(), height / bmp.height.toFloat()) * zoom
            val w = bmp.width * scale; val h = bmp.height * scale
            src.set(0, 0, bmp.width, bmp.height)
            dst.set((width - w) / 2f, (height - h) / 2f, (width + w) / 2f, (height + h) / 2f)
            paint.colorFilter = lively
            canvas.drawBitmap(bmp, src, dst, paint)
            paint.colorFilter = null
        } else {
            paint.shader = LinearGradient(
                0f, 0f, width.toFloat(), height.toFloat(),
                Ui.blend(accent, Color.BLACK, .25f), Ui.blend(accent, Color.BLACK, .78f),
                Shader.TileMode.CLAMP,
            )
            canvas.drawRect(bounds, paint)
            paint.shader = null
        }

        // a wash of the app's own colour, so two photographic cards never read as one
        paint.shader = LinearGradient(
            0f, 0f, width.toFloat(), height.toFloat(),
            Ui.withAlpha(accent, .30f), Ui.withAlpha(Ui.blend(accent, Color.BLACK, .6f), .38f),
            Shader.TileMode.CLAMP,
        )
        canvas.drawRect(bounds, paint)

        // top and bottom scrims: the label needs a floor whatever the still does
        paint.shader = LinearGradient(
            0f, 0f, 0f, height * .34f,
            0x38000000, 0x00000000, Shader.TileMode.CLAMP,
        )
        canvas.drawRect(bounds, paint)
        paint.shader = LinearGradient(
            0f, height.toFloat(), 0f, height * .32f,
            intArrayOf(0xF2040709.toInt(), 0xC7040709.toInt(), 0x00040709),
            floatArrayOf(0f, .34f, 1f), Shader.TileMode.CLAMP,
        )
        canvas.drawRect(bounds, paint)
        paint.shader = null

        // the app's own icon, in a glass tile
        icon?.let { d ->
            val size = Ui.px(this, 44f).toInt()
            val left = Ui.px(this, 20f).toInt()
            val top = Ui.px(this, 18f).toInt()
            val pad = Ui.px(this, 7f)
            paint.color = 0x24FFFFFF
            canvas.drawRoundRect(
                left.toFloat(), top.toFloat(), (left + size).toFloat(), (top + size).toFloat(),
                Ui.px(this, 13f), Ui.px(this, 13f), paint,
            )
            d.setBounds(
                (left + pad).toInt(), (top + pad).toInt(),
                (left + size - pad).toInt(), (top + size - pad).toInt(),
            )
            d.draw(canvas)
        }

        // label
        text.textSize = Ui.px(this, 19f)
        text.setShadowLayer(Ui.px(this, 14f), 0f, Ui.px(this, 1f), 0xBF000000.toInt())
        val labelY = height - Ui.px(this, if (progress > 0f) 26f else 18f)
        canvas.drawText(
            ellipsise(label, width - Ui.px(this, 40f)),
            Ui.px(this, 20f), labelY, text,
        )
        text.clearShadowLayer()

        badge?.let { b ->
            text.textSize = Ui.px(this, 12f)
            val w = text.measureText(b)
            val padX = Ui.px(this, 9f); val padY = Ui.px(this, 5f)
            val right = width - Ui.px(this, 20f)
            val top = Ui.px(this, 20f)
            paint.color = 0x73000000
            canvas.drawRoundRect(
                right - w - padX * 2, top, right, top + text.textSize + padY * 2,
                Ui.px(this, 6f), Ui.px(this, 6f), paint,
            )
            canvas.drawText(b, right - w - padX, top + text.textSize + padY * .6f, text)
        }

        if (progress > 0f) {
            val left = Ui.px(this, 20f)
            val right = width - Ui.px(this, 20f)
            val bottom = height - Ui.px(this, 12f)
            val hgt = Ui.px(this, 3f)
            paint.color = 0x38FFFFFF
            canvas.drawRoundRect(left, bottom - hgt, right, bottom, hgt, hgt, paint)
            paint.color = Color.WHITE
            canvas.drawRoundRect(left, bottom - hgt, left + (right - left) * progress, bottom, hgt, hgt, paint)
        }
        canvas.restore()

        // one edge, and it is the sweep. Unfocused cards get a hairline instead.
        if (picked) {
            Sweep.draw(canvas, ring, radius, Ui.px(this, 2f), accent, sweepAngle)
        } else {
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = Ui.px(this, 1f)
            paint.color = 0x1AFFFFFF
            canvas.drawRoundRect(ring, radius, radius, paint)
            paint.style = Paint.Style.FILL
        }
    }

    private fun ellipsise(s: String, max: Float): String {
        if (text.measureText(s) <= max) return s
        var end = s.length
        while (end > 1 && text.measureText(s.substring(0, end) + "…") > max) end--
        return s.substring(0, end) + "…"
    }
}
