package it.davideghiotto.jarvistv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.TypedValue
import android.view.View

/**
 * The design is drawn in the panel's own pixels.
 *
 * The preview in `tv-preview/` is laid out on a 1920x1080 stage, which is exactly the
 * surface Android composites on this set, and the TV runs at 320 dpi — so one value
 * from the preview is half that many dp. [px] does that conversion in one place so the
 * two can be compared without arithmetic in every call site.
 */
object Ui {
    /** A measurement taken from the 1920x1080 preview, in real device pixels. */
    fun px(view: View, previewPx: Float): Float = px(view.context, previewPx)

    fun px(ctx: Context, previewPx: Float): Float =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP, previewPx / 2f, ctx.resources.displayMetrics
        )

    fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t

    /** Blend two ARGB colours; `t` = 0 is [a]. */
    fun blend(a: Int, b: Int, t: Float): Int = Color.argb(
        lerp(Color.alpha(a).toFloat(), Color.alpha(b).toFloat(), t).toInt(),
        lerp(Color.red(a).toFloat(), Color.red(b).toFloat(), t).toInt(),
        lerp(Color.green(a).toFloat(), Color.green(b).toFloat(), t).toInt(),
        lerp(Color.blue(a).toFloat(), Color.blue(b).toFloat(), t).toInt(),
    )

    fun withAlpha(color: Int, alpha: Float): Int =
        Color.argb((alpha.coerceIn(0f, 1f) * 255).toInt(), Color.red(color), Color.green(color), Color.blue(color))

    /**
     * The colour an app's own artwork is "about", used for its card wash, its showcase
     * gradient and the Ambilight while it is focused.
     *
     * Not androidx.palette: this is one downscale and a scan, it runs once per app on a
     * background thread, and the library would be the only dependency added for it.
     * Pixels are weighted by saturation so a banner that is mostly dark grey still
     * yields the brand colour sitting in the middle of it.
     */
    fun dominantColour(drawable: Drawable?, fallback: Int): Int {
        val bmp = toBitmap(drawable, 32, 32) ?: return fallback
        val hsv = FloatArray(3)
        var wr = 0.0; var wg = 0.0; var wb = 0.0; var wsum = 0.0
        for (y in 0 until bmp.height) {
            for (x in 0 until bmp.width) {
                val c = bmp.getPixel(x, y)
                if (Color.alpha(c) < 128) continue
                Color.colorToHSV(c, hsv)
                // ignore near-black and near-white: neither says anything about a brand
                if (hsv[2] < .18f || (hsv[1] < .12f && hsv[2] > .92f)) continue
                val w = (hsv[1].toDouble() * .8 + .2) * (hsv[2].toDouble() * .6 + .4)
                wr += Color.red(c) * w; wg += Color.green(c) * w; wb += Color.blue(c) * w; wsum += w
            }
        }
        bmp.recycle()
        if (wsum <= 0) return fallback
        val c = Color.rgb((wr / wsum).toInt(), (wg / wsum).toInt(), (wb / wsum).toInt())
        // lift it: a card rim and an Ambilight both want a colour with some light in it
        Color.colorToHSV(c, hsv)
        hsv[1] = (hsv[1] * 1.25f).coerceAtMost(.9f)
        hsv[2] = hsv[2].coerceIn(.55f, 1f)
        return Color.HSVToColor(hsv)
    }

    fun toBitmap(drawable: Drawable?, w: Int, h: Int): Bitmap? {
        if (drawable == null) return null
        (drawable as? BitmapDrawable)?.bitmap?.let { src ->
            if (!src.isRecycled) return Bitmap.createScaledBitmap(src, w, h, true)
        }
        if (drawable.intrinsicWidth <= 0 || drawable.intrinsicHeight <= 0) return null
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        drawable.setBounds(0, 0, w, h)
        drawable.draw(canvas)
        return out
    }
}
