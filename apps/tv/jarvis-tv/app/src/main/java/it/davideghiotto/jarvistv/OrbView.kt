package it.davideghiotto.jarvistv

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/**
 * The JARVIS orb.
 *
 * Modelled on desertcache/samantha-ui, but not ported from it. There the orb is a
 * Three.js sphere whose vertices are displaced by 3D simplex noise in a vertex shader,
 * with a fresnel term in the fragment shader. Neither route is available here:
 * `RuntimeShader` (AGSL) arrived in API 33 and this set is Android 12, and a WebGL
 * canvas in a WebView is not a bet worth making on four Cortex-A53s with 2 GB of RAM
 * for the screen the assistant lives on.
 *
 * So the same idea is drawn with what android.graphics already has. The outline is one
 * closed curve, r(θ) = R · (1 + Σ aₖ·sin(fₖθ + drift)) over four coprime harmonics,
 * sampled 96 times and joined through the midpoints with a quadratic each side. The
 * body and the glow are RadialGradients. Nothing is blurred per frame — the first
 * version of this in the browser preview blurred its halo every frame and pegged a
 * desktop CPU, which is exactly the trap to avoid here.
 */
class OrbView @JvmOverloads constructor(
    ctx: Context, attrs: AttributeSet? = null, defStyle: Int = 0,
) : View(ctx, attrs, defStyle) {

    enum class State { IDLE, LISTENING, THINKING, SPEAKING, ERROR }

    private class Config(
        val amps: FloatArray,
        val speed: Float,
        val glow: Float,
        val scale: Float,
        val pulse: Float,
        val primary: Int,
        val secondary: Int,
        val rim: Int,
    )

    private companion object {
        val FREQ  = intArrayOf(2, 3, 5, 7)        // coprime: the shape never repeats
        val DRIFT = floatArrayOf(1f, -.62f, .83f, -1.1f)
        const val POINTS = 96

        val CONFIGS = mapOf(
            State.IDLE to Config(
                floatArrayOf(.026f, .034f, .018f, .008f), .10f, .38f, .88f, 0f,
                0xFFE8A87C.toInt(), 0xFF9A5B3C.toInt(), 0xFF6FC9FF.toInt()),
            State.LISTENING to Config(
                floatArrayOf(.032f, .044f, .024f, .011f), .20f, .52f, 1f, .05f,
                0xFFF3C7A2.toInt(), 0xFFD98A5A.toInt(), 0xFF7FD4FF.toInt()),
            State.THINKING to Config(
                floatArrayOf(.028f, .046f, .032f, .018f), .55f, .60f, .95f, .16f,
                0xFFC9B6FD.toInt(), 0xFF6D28D9.toInt(), 0xFF22D3EE.toInt()),
            State.SPEAKING to Config(
                floatArrayOf(.038f, .058f, .030f, .015f), .32f, .66f, 1.04f, .05f,
                0xFFFBBF24.toInt(), 0xFFC2410C.toInt(), 0xFFFFE1A8.toInt()),
            State.ERROR to Config(
                floatArrayOf(.020f, .026f, .014f, .007f), .14f, .40f, .86f, .30f,
                0xFFF87171.toInt(), 0xFF7F1D1D.toInt(), 0xFFFCA5A5.toInt()),
        )
    }

    var state: State = State.IDLE
        set(value) { field = value; if (isAttachedToWindow) invalidate() }

    /** 0..1 voice envelope. Drives the swell while speaking. */
    var amplitude: Float = 0f
        set(value) { field = value.coerceIn(0f, 1f) }

    /** The colour the orb is currently wearing — the Ambilight follows this. */
    var onColour: ((Int) -> Unit)? = null

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val path = Path()
    private val xs = FloatArray(POINTS)
    private val ys = FloatArray(POINTS)

    // the live values, eased toward the target so a state change is a transition
    private val amps = CONFIGS[State.IDLE]!!.amps.copyOf()
    private var speed = CONFIGS[State.IDLE]!!.speed
    private var glow = CONFIGS[State.IDLE]!!.glow
    private var scale = CONFIGS[State.IDLE]!!.scale
    private var pulse = CONFIGS[State.IDLE]!!.pulse
    private var primary = CONFIGS[State.IDLE]!!.primary
    private var secondary = CONFIGS[State.IDLE]!!.secondary
    private var rim = CONFIGS[State.IDLE]!!.rim

    private var t = 0f
    private var lastFrame = 0L
    private var running = false
    private var reportedColour = 0

    /** Runs only while the orb is the screen being shown: see [HomeActivity]. */
    fun start() {
        if (running) return
        running = true
        lastFrame = System.nanoTime()
        postInvalidateOnAnimation()
    }

    fun stop() { running = false }

    override fun onDetachedFromWindow() { super.onDetachedFromWindow(); stop() }

    private fun step() {
        val now = System.nanoTime()
        val dt = ((now - lastFrame) / 1e9f).coerceIn(0f, .05f)   // a stall must not jump
        lastFrame = now
        val c = CONFIGS[state]!!
        val k = 1f - Math.pow(.004, dt.toDouble()).toFloat()     // ~600 ms to settle
        for (i in amps.indices) amps[i] = Ui.lerp(amps[i], c.amps[i], k)
        speed = Ui.lerp(speed, c.speed, k)
        glow = Ui.lerp(glow, c.glow, k)
        scale = Ui.lerp(scale, c.scale, k)
        pulse = Ui.lerp(pulse, c.pulse, k)
        primary = Ui.blend(primary, c.primary, k)
        secondary = Ui.blend(secondary, c.secondary, k)
        rim = Ui.blend(rim, c.rim, k)
        t += dt * speed
        if (primary != reportedColour) { reportedColour = primary; onColour?.invoke(primary) }
    }

    private fun radius(theta: Float, r: Float): Float {
        var m = 1f
        for (i in 0 until 4) m += amps[i] * sin(FREQ[i] * theta + t * 6.2832f * DRIFT[i])
        m += amplitude * .16f * sin(2 * theta + t * 9f)
        return r * m
    }

    override fun onDraw(canvas: Canvas) {
        if (width == 0 || height == 0) return      // no gradient has a radius yet
        if (running) step()

        val w = width.toFloat(); val h = height.toFloat()
        val cx = w / 2f; val cy = h / 2f
        val breath = 1f + .012f * sin(t * 2.2f) + pulse * .05f * sin(t * 9f)
        val r = min(w, h) * .31f * scale * breath * (1f + amplitude * .05f)

        for (i in 0 until POINTS) {
            val a = (i.toFloat() / POINTS) * 6.2832f
            val rr = radius(a, r)
            xs[i] = cx + cos(a) * rr
            ys[i] = cy + sin(a) * rr
        }
        path.rewind()
        var mx = (xs[POINTS - 1] + xs[0]) / 2f
        var my = (ys[POINTS - 1] + ys[0]) / 2f
        path.moveTo(mx, my)
        for (i in 0 until POINTS) {
            val j = (i + 1) % POINTS
            mx = (xs[i] + xs[j]) / 2f
            my = (ys[i] + ys[j]) / 2f
            path.quadTo(xs[i], ys[i], mx, my)   // through the midpoints: no corners
        }
        path.close()

        // The glow is painted only inside the square it reaches — filling the whole
        // surface with a gradient is the one thing here that would cost real time. It
        // is also capped to half the view, because a gradient cut off by the view's
        // own bounds leaves a visible rectangle of light on screen.
        val haloR = (r * 2.05f).coerceIn(1f, minOf(w, h) / 2f)
        fill.shader = RadialGradient(
            cx, cy, haloR,
            intArrayOf(
                Ui.withAlpha(Ui.blend(primary, secondary, .25f), .60f * glow),
                Ui.withAlpha(secondary, .36f * glow),
                Ui.withAlpha(secondary, .13f * glow),
                Ui.withAlpha(secondary, 0f),
            ),
            floatArrayOf(.30f, .46f, .72f, 1f),
            Shader.TileMode.CLAMP,
        )
        canvas.drawRect(cx - haloR, cy - haloR, cx + haloR, cy + haloR, fill)

        // body: the light sits high and left, so the surface falls away from it
        fill.shader = RadialGradient(
            cx - r * .26f, cy - r * .32f, (r * 1.12f).coerceAtLeast(1f),
            intArrayOf(primary, primary, Ui.blend(primary, secondary, .42f), Ui.blend(primary, secondary, .72f)),
            floatArrayOf(0f, .58f, .86f, 1f),
            Shader.TileMode.CLAMP,
        )
        canvas.drawPath(path, fill)

        // chromatic rim: a cool edge above, a warm one below, each offset a pixel or
        // two. It is what stops the shape reading as a flat sticker.
        stroke.strokeWidth = (r * .008f).coerceAtLeast(2f)
        stroke.color = Ui.withAlpha(rim, .30f)
        canvas.save(); canvas.translate(-r * .010f, -r * .012f); canvas.drawPath(path, stroke); canvas.restore()
        stroke.color = Ui.withAlpha(secondary, .22f)
        canvas.save(); canvas.translate(r * .008f, r * .014f); canvas.drawPath(path, stroke); canvas.restore()

        // specular
        canvas.save()
        canvas.clipPath(path)
        fill.shader = RadialGradient(
            cx - r * .34f, cy - r * .42f, (r * .95f).coerceAtLeast(1f),
            Color.argb(66, 255, 255, 255), Color.argb(0, 255, 255, 255),
            Shader.TileMode.CLAMP,
        )
        canvas.drawRect(0f, 0f, w, h, fill)
        canvas.restore()

        if (running) postInvalidateOnAnimation()
    }
}
