package it.davideghiotto.jarvistv

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.animation.PathInterpolator
import androidx.appcompat.widget.AppCompatTextView
import androidx.core.content.ContextCompat

/**
 * One menu in the menu bar. [current] is the screen you are on (full ink); [lit] is
 * D-pad focus: a rounded highlight fades in behind the word, as macOS does when a
 * menu is open.
 */
class TabView @JvmOverloads constructor(
    ctx: Context, attrs: AttributeSet? = null,
) : AppCompatTextView(ctx, attrs) {

    private val ink = ContextCompat.getColor(ctx, R.color.menubar_ink)
    private val dim = ContextCompat.getColor(ctx, R.color.menubar_ink_2)
    private val hi = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x33FFFFFF }
    private var drawn = 0f

    private val anim = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 200
        interpolator = PathInterpolator(.16f, 1f, .3f, 1f)
        addUpdateListener { drawn = it.animatedValue as Float; invalidate() }
    }

    var current = false
        set(value) { field = value; recolour() }

    var lit = false
        set(value) {
            if (field == value) return
            field = value
            recolour()
            anim.cancel()
            anim.setFloatValues(drawn, if (value) 1f else 0f)
            anim.start()
        }

    private fun recolour() = setTextColor(if (current || lit) ink else dim)

    override fun onDraw(canvas: Canvas) {
        if (drawn > 0f) {
            hi.alpha = (0x33 * drawn).toInt()
            val r = Ui.px(this, 10f)
            canvas.drawRoundRect(0f, 0f, width.toFloat(), height.toFloat(), r, r, hi)
        }
        super.onDraw(canvas)
    }
}
