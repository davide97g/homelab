package it.davideghiotto.jarvistv

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import androidx.core.content.res.ResourcesCompat
import org.json.JSONArray
import org.json.JSONObject

/** A site the TV opens full screen, as the phone page (jarvis-server /api/sites) lists it. */
data class Site(val id: String, val name: String, val url: String) {
    val pkg get() = WebApps.PREFIX + id

    companion object {
        fun parseAll(arr: JSONArray?): List<Site> = (0 until (arr?.length() ?: 0)).mapNotNull { i ->
            val o = arr!!.optJSONObject(i) ?: return@mapNotNull null
            val url = o.optString("url").takeIf { it.startsWith("http://") || it.startsWith("https://") }
                ?: return@mapNotNull null
            Site(o.optString("id"), o.optString("name").ifBlank { url }, url)
        }
    }
}

/**
 * Web apps in the dock: each site is a LaunchableApp whose "package" is `web:<id>`,
 * opened in [WebAppActivity] instead of through the package manager.
 *
 * The list is kept in prefs as the server last sent it, so the dock has its sites
 * even while the mini PC is unreachable.
 */
object WebApps {
    const val PREFIX = "web:"
    private const val KEY = "sites_json"

    fun isWeb(pkg: String) = pkg.startsWith(PREFIX)

    fun cached(ctx: Context): List<Site> = runCatching {
        Site.parseAll(JSONArray(prefs(ctx).getString(KEY, "[]")))
    }.getOrDefault(emptyList())

    fun remember(ctx: Context, sites: List<Site>) {
        val arr = JSONArray()
        sites.forEach { arr.put(JSONObject().put("id", it.id).put("name", it.name).put("url", it.url)) }
        prefs(ctx).edit().putString(KEY, arr.toString()).apply()
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("jarvis", Context.MODE_PRIVATE)

    fun open(ctx: Context, name: String, url: String) {
        ctx.startActivity(
            Intent(ctx, WebAppActivity::class.java)
                .putExtra(WebAppActivity.EXTRA_URL, url)
                .putExtra(WebAppActivity.EXTRA_NAME, name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    /**
     * The dock entry. [icon] is the site's own artwork when the server found one: a
     * large one fills the tile, a small favicon sits in the middle of a white one so
     * it is not blown up into a blur. Without one, the initial on a colour.
     */
    fun entry(ctx: Context, site: Site, icon: Bitmap?): LaunchableApp {
        val tile = if (icon != null) iconTile(icon) else letterTile(ctx, site.name)
        val d: Drawable = BitmapDrawable(ctx.resources, tile)
        return LaunchableApp(
            label = site.name,
            pkg = site.pkg,
            banner = null,
            icon = d,
            accent = Ui.dominantColour(d, 0xFF4DE8F4.toInt()),
            iconHi = d,
            url = site.url,
        )
    }

    private const val S = 256

    private fun iconTile(icon: Bitmap): Bitmap {
        if (icon.width >= 120) return icon
        val out = Bitmap.createBitmap(S, S, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        c.drawColor(Color.WHITE)
        val side = S * .56f
        val l = (S - side) / 2f
        c.drawBitmap(icon, null, android.graphics.RectF(l, l, l + side, l + side),
            Paint(Paint.FILTER_BITMAP_FLAG))
        return out
    }

    private val hues = intArrayOf(
        0xFF4D96FF.toInt(), 0xFF9B72F2.toInt(), 0xFFFF8FAB.toInt(),
        0xFF5ED6D0.toInt(), 0xFFFFB347.toInt(), 0xFF6BCB77.toInt(),
    )

    private fun letterTile(ctx: Context, name: String): Bitmap {
        val out = Bitmap.createBitmap(S, S, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val base = hues[Math.floorMod(name.hashCode(), hues.size)]
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.shader = LinearGradient(0f, 0f, 0f, S.toFloat(), Ui.blend(base, Color.WHITE, .25f),
            Ui.blend(base, Color.BLACK, .25f), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, S.toFloat(), S.toFloat(), p)
        p.shader = null
        p.color = Color.WHITE
        p.typeface = ResourcesCompat.getFont(ctx, R.font.sora_medium)
        p.textSize = S * .52f
        val mark = name.take(1).uppercase()
        c.drawText(mark, (S - p.measureText(mark)) / 2f, S * .5f + p.textSize * .36f, p)
        return out
    }
}
