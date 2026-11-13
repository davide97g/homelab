package it.davideghiotto.jarvistv

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.util.AttributeSet
import android.view.Gravity
import android.view.animation.PathInterpolator
import android.widget.FrameLayout
import kotlin.math.abs
import kotlin.math.sign

/**
 * The apps on the outside of a drum: the focused one in front and largest, every step
 * out smaller and turned away. Left/right turns the drum; it wraps all the way round.
 *
 * The numbers in [SEEN] are the ones `tv-preview/studio.js` uses, as what you see on
 * the 1920x1080 stage: the centre offset in preview px, the scale, and the turn. On
 * the preview they are solved back into a CSS 3D transform; here they map straight
 * onto translationX, scaleX/Y and rotationY, which needs no solving at all.
 */
class CylinderLayout @JvmOverloads constructor(
    ctx: Context, attrs: AttributeSet? = null,
) : FrameLayout(ctx, attrs) {

    private companion object {
        /** step: centre offset (preview px), scale, turn (deg). The last row is off screen. */
        val SEEN = arrayOf(
            floatArrayOf(0f, 1.00f, 0f),
            floatArrayOf(300f, .80f, 12f),
            floatArrayOf(540f, .64f, 20f),
            floatArrayOf(740f, .52f, 26f),
            floatArrayOf(900f, .42f, 32f),
        )
        const val VISIBLE = 3

        /**
         * Which way rotationY turns a card's outer edge away from the viewer. View
         * rotationY is counter-clockwise looking down the y axis; if the set ever shows
         * the drum concave instead of convex, this is the one sign to flip.
         */
        const val TURN_AWAY = 1f
    }

    private val ease = PathInterpolator(.16f, 1f, .3f, 1f)
    private val cards = mutableListOf<FlipCardView>()
    private val pool = Paint(Paint.ANTI_ALIAS_FLAG)
    private var accent = 0xFF4DE8F4.toInt()

    var index = 0
        private set

    init {
        clipChildren = false
        clipToPadding = false
        setWillNotDraw(false)
    }

    val size get() = cards.size
    fun focusedCard(): FlipCardView? = cards.getOrNull(index)

    fun setApps(apps: List<LaunchableApp>, covers: Map<String, Bitmap>, progress: Map<String, Float>, focus: Int) {
        removeAllViews()
        cards.clear()
        val w = Ui.px(this, 260f).toInt()
        val h = Ui.px(this, 390f).toInt()
        apps.forEach { app ->
            val card = FlipCardView(context).apply {
                this.app = app
                cover = covers[app.pkg]
                this.progress = progress[app.pkg] ?: 0f
                cameraDistance = 14_000 * resources.displayMetrics.density
            }
            cards += card
            addView(card, LayoutParams(w, h, Gravity.CENTER))
        }
        index = focus.coerceIn(0, (cards.size - 1).coerceAtLeast(0))
        place(animate = false)
    }

    fun updateArt(covers: Map<String, Bitmap>, progress: Map<String, Float>) {
        cards.forEach { c ->
            val pkg = c.app?.pkg ?: return@forEach
            c.cover = covers[pkg]
            c.progress = progress[pkg] ?: 0f
        }
    }

    fun turn(by: Int) {
        if (cards.isEmpty()) return
        index = Math.floorMod(index + by, cards.size)
        place(animate = true)
    }

    fun setAccent(colour: Int) { accent = colour; invalidate() }

    /** Shortest way round the drum. */
    private fun wrap(d: Int): Int {
        val n = cards.size
        val half = n / 2
        return Math.floorMod(d + half, n) - half
    }

    private fun place(animate: Boolean) {
        cards.forEachIndexed { i, card ->
            val d = wrap(i - index)
            val stepN = minOf(abs(d), SEEN.size - 1)
            val (off, s, turn) = SEEN[stepN].let { Triple(it[0], it[1], it[2]) }
            val sgn = if (d == 0) 1f else d.toFloat().sign
            val tx = sgn * Ui.px(this, off)
            val ry = sgn * turn * TURN_AWAY
            val alpha = if (abs(d) > VISIBLE) 0f else 1f
            // a card that wraps from one edge to the other must not fly across
            val jump = abs(d - card.step) > 1
            card.step = d
            card.focused = d == 0
            card.z = Ui.px(this, (20 - stepN).toFloat())   // the centre draws on top
            card.animate().cancel()
            if (!animate || jump) {
                card.translationX = tx; card.scaleX = s; card.scaleY = s
                card.rotationY = ry; card.alpha = alpha
            } else {
                card.animate().translationX(tx).scaleX(s).scaleY(s).rotationY(ry).alpha(alpha)
                    .setDuration(560).setInterpolator(ease).start()
            }
        }
        invalidate()
    }

    /** A pool of the focused app's colour on the floor under the front card. */
    override fun dispatchDraw(canvas: Canvas) {
        if (width > 0 && cards.isNotEmpty()) {
            val cx = width / 2f
            val cy = height / 2f + Ui.px(this, 196f)
            val r = Ui.px(this, 130f).coerceAtLeast(1f)
            pool.shader = RadialGradient(cx, cy, r, Ui.withAlpha(accent, .35f), 0, Shader.TileMode.CLAMP)
            canvas.save()
            canvas.scale(1f, .16f, cx, cy)
            canvas.drawCircle(cx, cy, r, pool)
            canvas.restore()
        }
        super.dispatchDraw(canvas)
    }
}
