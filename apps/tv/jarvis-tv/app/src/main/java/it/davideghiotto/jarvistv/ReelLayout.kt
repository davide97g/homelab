package it.davideghiotto.jarvistv

import android.animation.ObjectAnimator
import android.content.Context
import android.util.AttributeSet
import android.view.View
import android.view.ViewGroup
import android.view.animation.PathInterpolator

/**
 * The three screens — apps, JARVIS, homelab — stacked one above the next, with the
 * whole column sliding. Each child is laid out at the full size of this view, so a
 * screen is always exactly the panel, and moving between them is one translation
 * rather than three visibility flips.
 */
class ReelLayout @JvmOverloads constructor(
    ctx: Context, attrs: AttributeSet? = null, defStyle: Int = 0,
) : ViewGroup(ctx, attrs, defStyle) {

    init {
        // The second and third screens are laid out below this view's own bounds and
        // only slide into them, so both this group and the one holding it have to stop
        // clipping — otherwise everything past the first screen is drawn and thrown
        // away, and the reel looks empty.
        clipChildren = false
        clipToPadding = false
    }

    private val ease = PathInterpolator(.16f, 1f, .3f, 1f)
    private var animator: ObjectAnimator? = null

    var index = 0
        private set

    override fun onMeasure(widthSpec: Int, heightSpec: Int) {
        val w = MeasureSpec.getSize(widthSpec)
        val h = MeasureSpec.getSize(heightSpec)
        val childW = MeasureSpec.makeMeasureSpec(w, MeasureSpec.EXACTLY)
        val childH = MeasureSpec.makeMeasureSpec(h, MeasureSpec.EXACTLY)
        for (i in 0 until childCount) getChildAt(i).measure(childW, childH)
        setMeasuredDimension(w, h)
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val h = b - t
        for (i in 0 until childCount) {
            getChildAt(i).layout(0, i * h, r - l, i * h + h)
        }
    }

    fun goTo(next: Int, animate: Boolean = true) {
        val clamped = next.coerceIn(0, childCount - 1)
        index = clamped
        val target = -clamped.toFloat() * height
        animator?.cancel()
        if (!animate || height == 0) { translationY = target; return }
        animator = ObjectAnimator.ofFloat(this, View.TRANSLATION_Y, translationY, target).apply {
            duration = 620
            interpolator = ease
            start()
        }
    }
}
