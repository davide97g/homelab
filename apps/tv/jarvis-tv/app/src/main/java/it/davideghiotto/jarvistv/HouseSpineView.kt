package it.davideghiotto.jarvistv

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import android.view.animation.PathInterpolator
import androidx.core.content.ContextCompat
import kotlin.math.PI
import kotlin.math.sin

/**
 * Four systems on one wire: this set, the host, the service probes, the tunnel.
 *
 * The wake draws the wire, locks the word "Casa in linea" (drawn by the sibling
 * label), then the wrap this view sits in translates back up under the clock.
 * After that a short spark keeps walking the wire so the house never looks idle.
 * No blur and no shader — a line, four circles, eight strings.
 */
class HouseSpineView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null,
) : View(context, attrs) {

    data class Node(val name: String, val meta: String, val warn: Boolean)

    /** word alpha, and whether the ceremony still owns the screen. */
    var onFrame: ((word: Float, acquiring: Boolean) -> Unit)? = null

    var acquiring = false
        private set

    private val curve = PathInterpolator(.16f, 1f, .3f, 1f)
    private val ok = ContextCompat.getColor(context, R.color.ok)
    private val warnC = ContextCompat.getColor(context, R.color.warn)
    private val ivory = ContextCompat.getColor(context, R.color.ivory)
    private val ink = ContextCompat.getColor(context, R.color.text_primary)
    private val ink2 = ContextCompat.getColor(context, R.color.text_secondary)

    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ivory
        strokeCap = Paint.Cap.ROUND
        strokeWidth = Ui.px(context, 1.75f)
    }
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Ui.withAlpha(ivory, .42f)
        strokeCap = Paint.Cap.ROUND
        strokeWidth = Ui.px(context, 6f)
    }
    private val sparkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = ivory
        strokeCap = Paint.Cap.ROUND
        strokeWidth = Ui.px(context, 2.5f)
    }
    private val lampPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val namePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = Ui.px(context, 16f)
        letterSpacing = .16f
        typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
        setShadowLayer(Ui.px(context, 14f), 0f, Ui.px(context, 2f), 0xCC000000.toInt())
    }
    private val metaPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = Ui.px(context, 15f)
        setShadowLayer(Ui.px(context, 14f), 0f, Ui.px(context, 2f), 0xCC000000.toInt())
    }

    private var nodes = Array(4) { Node("—", "—", false) }
    private var line = 1f
    private var pulse = 0f
    private val shown = FloatArray(4) { 1f }
    private var lampPop = 1f
    private var travel = 0f

    private val clock = ValueAnimator.ofFloat(0f, TOTAL).apply {
        duration = TOTAL.toLong()
        interpolator = LinearInterpolator()
        addUpdateListener { frame(it.animatedValue as Float) }
        addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) {
                if (acquiring) dock()
            }
        })
    }

    private val walker = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 3_400
        repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener {
            pulse = it.animatedValue as Float
            if (!acquiring) invalidate()
        }
    }

    init {
        nodes[0] = Node(
            context.getString(R.string.house_tv).uppercase(),
            context.getString(R.string.house_tv_meta),
            false,
        )
        nodes[1] = Node(context.getString(R.string.house_host).uppercase(), "—", false)
        nodes[2] = Node(context.getString(R.string.house_services).uppercase(), "—", false)
        nodes[3] = Node(context.getString(R.string.house_tunnel).uppercase(), "—", false)
    }

    fun bind(linkUp: Boolean, host: HostStatus?, services: List<Service>) {
        val up = services.count { it.up }
        val down = services.firstOrNull { !it.up }
        val tunnel = services.firstOrNull { it.name.equals("cloudflared", ignoreCase = true) }
        nodes[0] = Node(
            context.getString(R.string.house_tv).uppercase(),
            context.getString(R.string.house_tv_meta),
            !linkUp,
        )
        nodes[1] = Node(
            context.getString(R.string.house_host).uppercase(),
            host?.uptime ?: "—",
            false,
        )
        nodes[2] = Node(
            context.getString(R.string.house_services).uppercase(),
            when {
                services.isEmpty() -> "—"
                down != null -> "$up di ${services.size} · ${down.name} muto"
                else -> "$up di ${services.size}"
            },
            down != null,
        )
        nodes[3] = Node(
            context.getString(R.string.house_tunnel).uppercase(),
            if (tunnel?.up == true) "cloudflared · ${tunnel.ms} ms" else if (tunnel == null) "—" else "offline",
            tunnel != null && !tunnel.up,
        )
        invalidate()
    }

    /** Drop the strip to the middle, run the wake, carry it back up. */
    fun play() {
        val parentH = (parent?.parent as? View)?.height ?: return
        if (parentH == 0) return
        val wrap = parent as View
        travel = parentH / 2f - wrap.top - wrap.height / 2f - Ui.px(context, 36f)
        wrap.translationY = travel
        line = 0f
        shown.fill(0f)
        lampPop = 1f
        acquiring = true
        onFrame?.invoke(0f, true)
        walker.cancel()
        clock.cancel()
        clock.start()
    }

    /** The remote wins. Snap to the docked strip. */
    fun finish() {
        if (!acquiring) return
        clock.cancel()
        dock()
    }

    fun startWalker() {
        if (!acquiring && !walker.isRunning) walker.start()
    }

    fun stopWalker() {
        walker.cancel()
    }

    private fun dock() {
        acquiring = false
        line = 1f
        lampPop = 1f
        shown.fill(1f)
        (parent as? View)?.translationY = 0f
        onFrame?.invoke(0f, false)
        startWalker()
        invalidate()
    }

    private fun frame(t: Float) {
        line = eased((t - 60f) / 860f)
        for (i in 0 until 4) shown[i] = eased((t - i * 140f) / 520f)
        val confirm = ((t - 1120f) / 480f).coerceIn(0f, 1f)
        lampPop = if (t < 1120f) 1f else 1f + sin(confirm * PI).toFloat() * .85f
        val dockT = eased((t - 2140f) / 700f)
        (parent as? View)?.translationY = travel * (1f - dockT)
        val wordIn = eased((t - 1120f) / 380f)
        val wordOut = eased((t - 2140f) / 240f)
        val word = if (t < 2140f) wordIn else 1f - wordOut
        onFrame?.invoke(word, true)
        invalidate()
    }

    private fun eased(p: Float) = curve.getInterpolation(p.coerceIn(0f, 1f))

    override fun onDraw(canvas: Canvas) {
        val r = Ui.px(context, 6f)
        val y = r
        val xs = floatArrayOf(r, width * .345f, width * .647f, width - r)
        val x1 = xs[0]
        val x2 = xs[3]
        val drawn = x1 + (x2 - x1) * line
        if (drawn > x1) {
            canvas.drawLine(x1, y, drawn, y, glowPaint)
            canvas.drawLine(x1, y, drawn, y, linePaint)
        }
        if (!acquiring && line >= 1f) {
            val len = x2 - x1
            val spark = len * .08f
            val head = pulse * (len + spark)
            val a = (x1 + head - spark).coerceAtLeast(x1)
            val b = (x1 + head).coerceAtMost(x2)
            if (b > a) canvas.drawLine(a, y, b, y, sparkPaint)
        }

        val nameY = y + r + Ui.px(context, 26f)
        val metaY = nameY + Ui.px(context, 18f)
        val aligns = arrayOf(Paint.Align.LEFT, Paint.Align.CENTER, Paint.Align.CENTER, Paint.Align.RIGHT)
        for (i in 0 until 4) {
            val a = shown[i]
            if (a <= 0f) continue
            val node = nodes[i]
            val colour = if (node.warn) warnC else ok
            lampPaint.color = Ui.withAlpha(colour, a)
            val pop = if (lampPop == 1f) 1f else lampPop
            canvas.drawCircle(xs[i], y, r * pop, lampPaint)
            namePaint.color = Ui.withAlpha(if (node.warn) warnC else ink, a)
            namePaint.textAlign = aligns[i]
            metaPaint.color = Ui.withAlpha(if (node.warn) warnC else ink2, a)
            metaPaint.textAlign = aligns[i]
            val tx = when (aligns[i]) {
                Paint.Align.LEFT -> xs[i] - r
                Paint.Align.RIGHT -> xs[i] + r
                else -> xs[i]
            }
            canvas.drawText(node.name, tx, nameY, namePaint)
            canvas.drawText(node.meta, tx, metaY, metaPaint)
        }
    }

    override fun onDetachedFromWindow() {
        clock.cancel()
        walker.cancel()
        super.onDetachedFromWindow()
    }

    private companion object {
        const val TOTAL = 2840f
    }
}
