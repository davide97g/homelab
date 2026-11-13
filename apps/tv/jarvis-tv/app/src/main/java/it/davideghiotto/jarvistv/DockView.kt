package it.davideghiotto.jarvistv

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Drawable
import android.util.AttributeSet
import android.view.View
import android.view.animation.PathInterpolator
import androidx.core.content.res.ResourcesCompat
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.sin

/**
 * The apps, as a macOS dock: a strip of frosted glass along the bottom with the icons
 * standing on it. The D-pad selector is the pointer: the icon under it swells and its
 * neighbours swell less the further they are, on a gaussian, so moving the selector
 * rolls a wave along the dock — the magnification. The selector position is animated
 * as a float, so the wave slides between icons rather than jumping.
 *
 * Icons grow upward from the glass, the glass widens with them, and the name sits in a
 * tooltip above the selected icon. Apps that are playing or part way through get the
 * running dot. The "all apps" entry sits after a divider, drawn as a Launchpad grid.
 *
 * Every size is a 1920x1080 preview pixel through [Ui.px].
 */
class DockView @JvmOverloads constructor(
    ctx: Context, attrs: AttributeSet? = null,
) : View(ctx, attrs) {

    private companion object {
        const val BASE = 104f        // icon at rest
        const val MAG = 1.72f        // the icon under the selector
        const val SIGMA = 1.05f      // how far the wave reaches, in icons
        const val GAP = 16f
        const val PAD = 14f          // glass around the resting icons
        const val BOTTOM = 26f       // glass to the bottom of the screen
        const val DIVIDER = 30f      // extra room either side of the divider
    }

    private var apps: List<LaunchableApp> = emptyList()
    private var tiles: List<Bitmap?> = emptyList()
    /** Tiles whose icon brings its own shape (round, cut-out): drawn as is, no white square. */
    private var free: Set<Int> = emptySet()
    private var running: Set<String> = emptySet()
    private var progress: Map<String, Float> = emptyMap()
    private var subtitles: Map<String, String> = emptyMap()

    var index = 0
        private set
    private var at = 0f                // the selector, as a float position
    private var bounce = 0f            // 0..1 through an opening bounce
    private var tipAlpha = 1f

    private val ease = PathInterpolator(.2f, .9f, .25f, 1f)
    private val mover = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 300
        interpolator = ease
        addUpdateListener { at = it.animatedValue as Float; invalidate() }
    }
    private val bouncer = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 760
        addUpdateListener { bounce = it.animatedValue as Float; invalidate() }
    }
    private val tipFader = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 220
        addUpdateListener { tipAlpha = it.animatedValue as Float; invalidate() }
    }

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val glass = Paint(Paint.ANTI_ALIAS_FLAG)
    private val rim = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = ResourcesCompat.getFont(ctx, R.font.sora_medium)
    }
    private val sub = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = ResourcesCompat.getFont(ctx, R.font.sora)
    }
    private val tileClip = Path()
    private val src = Rect()
    private val box = RectF()
    private val plate = RectF()

    // laid out per frame
    private var rects = Array(0) { RectF() }

    init {
        setLayerType(LAYER_TYPE_HARDWARE, null)
    }

    private fun p(v: Float) = Ui.px(this, v)

    fun setApps(next: List<LaunchableApp>, focus: Int) {
        apps = next
        val made = next.map { if (it.pkg == Apps.MORE) null else tile(it.iconHi ?: it.icon) }
        tiles = made.map { it?.first }
        free = made.indices.filter { made[it]?.second == true }.toSet()
        rects = Array(next.size) { RectF() }
        index = focus.coerceIn(0, (next.size - 1).coerceAtLeast(0))
        mover.cancel()
        at = index.toFloat()
        invalidate()
    }

    fun setStatus(running: Set<String>, progress: Map<String, Float>, subtitles: Map<String, String>) {
        this.running = running; this.progress = progress; this.subtitles = subtitles
        invalidate()
    }

    fun move(by: Int) {
        if (apps.isEmpty()) return
        val next = (index + by).coerceIn(0, apps.size - 1)
        if (next == index) return
        index = next
        mover.cancel()
        mover.setFloatValues(at, index.toFloat())
        mover.start()
        tipFader.cancel(); tipFader.start()
    }

    /** The two-hop bounce macOS gives an app that is starting. */
    fun bounce() { bouncer.cancel(); bouncer.start() }

    /** Where the selected icon is drawn right now, in this view's coordinates. */
    fun selectedRect(): RectF? = rects.getOrNull(index)?.let { RectF(it) }

    /**
     * The icon at the largest size it is drawn. An icon that fills its square is cut
     * to a rounded square on white; one with transparent corners (Spotify's circle)
     * already has a shape, so it is left alone, like a non-squircle icon on a Mac.
     *
     * @return the tile, and whether it keeps its own shape
     */
    private fun tile(d: Drawable): Pair<Bitmap, Boolean> {
        val s = p(BASE * MAG).toInt().coerceAtLeast(64)
        val raw = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888)
        val old = d.copyBounds()
        d.setBounds(0, 0, s, s)
        d.draw(Canvas(raw))
        d.bounds = old
        val k = (s * .06f).toInt()
        val corners = listOf(raw.getPixel(k, k), raw.getPixel(s - 1 - k, k),
            raw.getPixel(k, s - 1 - k), raw.getPixel(s - 1 - k, s - 1 - k))
        if (corners.all { Color.alpha(it) < 40 }) return raw to true

        val out = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val r = s * .225f
        c.clipPath(Path().apply { addRoundRect(0f, 0f, s.toFloat(), s.toFloat(), r, r, Path.Direction.CW) })
        c.drawColor(Color.WHITE)
        c.drawBitmap(raw, 0f, 0f, null)
        raw.recycle()
        return out to false
    }

    private fun scaleOf(i: Int): Float {
        val d = i - at
        return 1f + (MAG - 1f) * exp(-(d * d) / (2f * SIGMA * SIGMA))
    }

    private fun hasDivider(i: Int) = i > 0 && apps[i].pkg == Apps.MORE

    override fun onDraw(canvas: Canvas) {
        if (apps.isEmpty() || width == 0) return
        val n = apps.size

        // shrink the resting size when everything is out, so the dock always fits
        val dividers = (0 until n).count(::hasDivider)
        val room = width * .92f - p(PAD) * 2 - p(DIVIDER) * 2 * dividers
        val base = minOf(p(BASE), (room - p(GAP) * (n - 1) - p(BASE) * (MAG - 1) * 2.2f) / n)
        val gap = p(GAP) * (base / p(BASE)).coerceAtMost(1f)

        val sizes = FloatArray(n) { base * scaleOf(it) }
        val total = sizes.sum() + gap * (n - 1) + p(DIVIDER) * 2 * dividers
        val floor = height - p(BOTTOM) - p(PAD)          // where the icons stand
        var x = (width - total) / 2f

        // ── glass ────────────────────────────────────────────────────────────────
        plate.set(x - p(PAD), floor - base - p(PAD), x + total + p(PAD), height - p(BOTTOM))
        val pr = p(30f)
        glass.shader = null
        glass.color = 0x00000000
        glass.setShadowLayer(p(30f), 0f, p(8f), 0x33000000)
        glass.color = Color.argb(150, 238, 233, 228)
        canvas.drawRoundRect(plate, pr, pr, glass)
        glass.clearShadowLayer()
        glass.shader = LinearGradient(0f, plate.top, 0f, plate.bottom,
            Color.argb(90, 255, 255, 255), Color.argb(20, 255, 255, 255), Shader.TileMode.CLAMP)
        canvas.drawRoundRect(plate, pr, pr, glass)
        glass.shader = null
        rim.strokeWidth = p(1.5f)
        rim.color = Color.argb(150, 255, 255, 255)
        canvas.drawRoundRect(plate, pr, pr, rim)
        rim.strokeWidth = p(1f)
        rim.color = Color.argb(28, 0, 0, 0)
        box.set(plate); box.inset(-p(1f), -p(1f))
        canvas.drawRoundRect(box, pr + p(1f), pr + p(1f), rim)

        // ── icons ────────────────────────────────────────────────────────────────
        val hop = if (bouncer.isRunning) abs(sin(bounce * 2 * PI.toFloat())) * base * .55f * (1f - .45f * bounce) else 0f
        for (i in 0 until n) {
            if (hasDivider(i)) {
                val lx = x + p(DIVIDER) - gap / 2f
                rim.color = Color.argb(60, 0, 0, 0)
                rim.strokeWidth = p(1.5f)
                canvas.drawLine(lx, plate.top + p(18f), lx, plate.bottom - p(18f), rim)
                x += p(DIVIDER) * 2
            }
            val s = sizes[i]
            val lift = if (i == index) hop else 0f
            val r = rects[i]
            r.set(x, floor - s - lift, x + s, floor - lift)
            drawIcon(canvas, i, r)
            if (apps[i].pkg in running) {
                paint.color = Color.argb(200, 30, 24, 20)
                canvas.drawCircle(r.centerX(), floor + p(PAD) * .55f, p(4f), paint)
            }
            x += s + gap
        }

        drawTooltip(canvas, base)
    }

    private fun drawIcon(canvas: Canvas, i: Int, r: RectF) {
        val rad = r.width() * .225f
        if (i !in free) {
            // a soft contact shadow, so the icons stand on the glass
            paint.setShadowLayer(r.width() * .08f, 0f, r.width() * .04f, 0x40000000)
            paint.color = Color.WHITE
            canvas.drawRoundRect(r, rad, rad, paint)
            paint.clearShadowLayer()
        }

        val bmp = tiles.getOrNull(i)
        if (bmp != null) {
            src.set(0, 0, bmp.width, bmp.height)
            canvas.drawBitmap(bmp, src, r, paint)
        } else {
            drawLaunchpad(canvas, r, rad)
        }

        progress[apps[i].pkg]?.takeIf { it > 0f }?.let { f ->
            val l = r.left + r.width() * .14f; val rr = r.right - r.width() * .14f
            val h = r.width() * .055f; val y = r.bottom - r.width() * .16f
            paint.color = Color.argb(150, 0, 0, 0)
            canvas.drawRoundRect(l, y, rr, y + h, h, h, paint)
            paint.color = Color.WHITE
            canvas.drawRoundRect(l, y, l + (rr - l) * f.coerceIn(0f, 1f), y + h, h, h, paint)
        }
    }

    private val padColours = intArrayOf(
        0xFFFF6B6B.toInt(), 0xFFFFB347.toInt(), 0xFFFFE066.toInt(),
        0xFF6BCB77.toInt(), 0xFF4D96FF.toInt(), 0xFF9B72F2.toInt(),
        0xFFFF8FAB.toInt(), 0xFF5ED6D0.toInt(), 0xFFB0B7C3.toInt(),
    )

    /** "All apps": a 3x3 grid of coloured squares on a light tile, like Launchpad. */
    private fun drawLaunchpad(canvas: Canvas, r: RectF, rad: Float) {
        tileClip.rewind()
        tileClip.addRoundRect(r, rad, rad, Path.Direction.CW)
        canvas.save()
        canvas.clipPath(tileClip)
        paint.shader = LinearGradient(0f, r.top, 0f, r.bottom,
            0xFFF4F1EE.toInt(), 0xFFD9D4CF.toInt(), Shader.TileMode.CLAMP)
        canvas.drawRect(r, paint)
        paint.shader = null
        val cell = r.width() * .17f; val g = r.width() * .07f
        val start = r.centerX() - (cell * 3 + g * 2) / 2f
        val top = r.centerY() - (cell * 3 + g * 2) / 2f
        for (row in 0..2) for (col in 0..2) {
            paint.color = padColours[row * 3 + col]
            val l = start + col * (cell + g); val t = top + row * (cell + g)
            canvas.drawRoundRect(l, t, l + cell, t + cell, cell * .28f, cell * .28f, paint)
        }
        canvas.restore()
    }

    private fun drawTooltip(canvas: Canvas, base: Float) {
        val r = rects.getOrNull(index) ?: return
        val app = apps[index]
        val title = app.label
        val line = subtitles[app.pkg]

        text.textSize = p(26f)
        sub.textSize = p(19f)
        val tw = text.measureText(title)
        val sw = line?.let { sub.measureText(it) } ?: 0f
        val maxW = width * .5f
        val w = (maxOf(tw, sw.coerceAtMost(maxW)) + p(36f))
        val h = if (line != null) p(84f) else p(52f)

        // follow the wave, not the target, so the tooltip glides with the icon
        val cx = (r.centerX()).coerceIn(w / 2f + p(16f), width - w / 2f - p(16f))
        val bottom = height - p(BOTTOM) - p(PAD) * 2 - base * MAG - p(22f)
        box.set(cx - w / 2f, bottom - h, cx + w / 2f, bottom)

        val a = tipAlpha.coerceIn(0f, 1f)
        val slide = (1f - a) * p(8f)
        box.offset(0f, slide)
        glass.shader = null
        glass.setShadowLayer(p(18f), 0f, p(6f), Ui.withAlpha(0xFF000000.toInt(), .22f * a))
        glass.color = Color.argb((235 * a).toInt(), 248, 245, 242)
        canvas.drawRoundRect(box, p(14f), p(14f), glass)
        glass.clearShadowLayer()

        text.color = Ui.withAlpha(0xFF1E1814.toInt(), a)
        val ty = box.top + p(34f)
        canvas.drawText(title, box.centerX() - tw / 2f, ty, text)
        if (line != null) {
            sub.color = Ui.withAlpha(0xFF1E1814.toInt(), .62f * a)
            val shown = ellipsize(line, maxW)
            canvas.drawText(shown, box.centerX() - sub.measureText(shown) / 2f, ty + p(32f), sub)
        }
    }

    private fun ellipsize(s: String, maxW: Float): String {
        if (sub.measureText(s) <= maxW) return s
        var end = s.length
        while (end > 1 && sub.measureText(s, 0, end) + sub.measureText("…") > maxW) end--
        return s.substring(0, end).trimEnd() + "…"
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        mover.cancel(); bouncer.cancel(); tipFader.cancel()
    }
}
