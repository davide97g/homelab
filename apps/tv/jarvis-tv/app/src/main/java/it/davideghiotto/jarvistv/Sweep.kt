package it.davideghiotto.jarvistv

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.SweepGradient

/**
 * The travelling light that runs round a card's edge, and round the whole frame while
 * an app opens.
 *
 * A SweepGradient rotated by a Matrix, stroked along a rounded rect — the same figure
 * the browser preview draws with `conic-gradient(from var(--angle), …)`. The steady rim
 * and the moving highlight are one stroke, so a focused card never shows two concentric
 * edges.
 */
object Sweep {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }

    /**
     * @param angle degrees, 0..360
     * @param base  alpha of the steady rim under the highlight
     */
    fun draw(
        canvas: Canvas, rect: RectF, radius: Float, width: Float,
        accent: Int, angle: Float, alpha: Float = 1f, base: Float = .5f,
    ) {
        if (alpha <= .01f) return
        val cx = rect.centerX(); val cy = rect.centerY()
        val steady = Ui.withAlpha(Color.WHITE, base * alpha)
        val shader = SweepGradient(
            cx, cy,
            intArrayOf(
                steady,
                steady,
                Ui.blend(steady, Ui.withAlpha(accent, alpha), .8f),
                Ui.withAlpha(Color.WHITE, alpha),
                Ui.blend(steady, Ui.withAlpha(accent, alpha), .8f),
                steady,
            ),
            floatArrayOf(0f, .56f, .83f, .94f, .98f, 1f),
        )
        shader.setLocalMatrix(android.graphics.Matrix().apply { setRotate(angle, cx, cy) })
        paint.shader = shader
        paint.strokeWidth = width
        canvas.drawRoundRect(rect, radius, radius, paint)
        paint.shader = null
    }
}
