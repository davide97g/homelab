package it.davideghiotto.jarvistv

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
import android.view.View
import androidx.core.content.res.ResourcesCompat

/**
 * One app on the drum: a portrait card, 260x390 on the preview stage.
 *
 * With a cover it is the cover, centre-cropped. Without one — most Android TV apps
 * ship a banner, never artwork — it is the app's own colour falling to near-black
 * with its initial set large, the same fallback the panel behind it uses.
 *
 * The drum's geometry (offset, scale, turn) is applied from outside through the
 * View's own translationX / scale / rotationY, so this only ever draws a flat card.
 */
class FlipCardView(ctx: Context) : View(ctx) {

    var app: LaunchableApp? = null
        set(value) { field = value; invalidate() }
    var cover: Bitmap? = null
        set(value) { field = value; invalidate() }
    var progress = 0f
        set(value) { field = value; invalidate() }
    var focused = false
        set(value) { field = value; invalidate() }

    /** Where the card currently sits on the drum, in steps from the focused one. */
    var step = 0

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        typeface = ResourcesCompat.getFont(ctx, R.font.sora)
    }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.WHITE }
    private val clip = Path()
    private val box = RectF()
    private val src = Rect()
    private val dst = RectF()

    private val radius get() = Ui.px(this, 24f)

    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        box.set(0f, 0f, w.toFloat(), h.toFloat())
        clip.rewind()
        clip.addRoundRect(box, radius, radius, Path.Direction.CW)
    }

    override fun onDraw(canvas: Canvas) {
        // never throw from a draw call: a launcher that dies here drops the set to live TV
        if (width == 0 || height == 0) return
        val a = app ?: return
        canvas.save()
        canvas.clipPath(clip)

        val bmp = cover
        if (bmp != null && !bmp.isRecycled) {
            val scale = maxOf(width / bmp.width.toFloat(), height / bmp.height.toFloat())
            val w = bmp.width * scale; val h = bmp.height * scale
            src.set(0, 0, bmp.width, bmp.height)
            dst.set((width - w) / 2f, (height - h) / 2f, (width + w) / 2f, (height + h) / 2f)
            canvas.drawBitmap(bmp, src, dst, paint)
        } else {
            paint.shader = RadialGradient(
                width * .2f, height * .1f, (height * 1.1f).coerceAtLeast(1f),
                intArrayOf(a.accent, Ui.blend(a.accent, Color.BLACK, .6f), 0xFF0A0706.toInt()),
                floatArrayOf(0f, .55f, 1f), Shader.TileMode.CLAMP,
            )
            canvas.drawRect(box, paint)
            paint.shader = null
            val mark = a.label.take(1).uppercase()
            text.textSize = Ui.px(this, 120f)
            text.alpha = 217
            canvas.drawText(mark, (width - text.measureText(mark)) / 2f, height / 2f + text.textSize * .36f, text)
        }

        // the cover sits a stop down off-focus so the drum reads as one surface; the
        // focused card gets a floor of shade for its label instead
        if (focused) {
            paint.shader = LinearGradient(
                0f, height * .55f, 0f, height.toFloat(),
                0x000A0707, 0x8C0A0707.toInt(), Shader.TileMode.CLAMP,
            )
            canvas.drawRect(box, paint)
            paint.shader = null
        } else {
            paint.color = 0x240E0909
            canvas.drawRect(box, paint)
        }

        if (progress > 0f) {
            val l = Ui.px(this, 14f); val r = width - l
            val y = height - Ui.px(this, 40f); val h = Ui.px(this, 3f)
            paint.color = 0x40FFFFFF
            canvas.drawRoundRect(l, y, r, y + h, h, h, paint)
            paint.color = Color.WHITE
            canvas.drawRoundRect(l, y, l + (r - l) * progress.coerceIn(0f, 1f), y + h, h, h, paint)
        }

        if (focused) {
            text.textSize = Ui.px(this, 15f)
            text.alpha = 255
            text.setShadowLayer(Ui.px(this, 10f), 0f, Ui.px(this, 1f), 0xCC000000.toInt())
            val label = a.label
            canvas.drawText(label, (width - text.measureText(label)) / 2f, height - Ui.px(this, 14f), text)
            text.clearShadowLayer()
        }
        canvas.restore()

        if (focused) {
            val sw = Ui.px(this, 3f)
            ring.strokeWidth = sw
            canvas.drawRoundRect(sw / 2, sw / 2, width - sw / 2, height - sw / 2, radius - sw / 2, radius - sw / 2, ring)
        }
    }
}
