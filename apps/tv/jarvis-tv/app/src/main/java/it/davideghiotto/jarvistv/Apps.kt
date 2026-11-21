package it.davideghiotto.jarvistv

import android.content.Context
import android.content.Intent
import android.graphics.drawable.Drawable
import android.util.DisplayMetrics

/**
 * @param banner the app's own leanback banner — real artwork, from the TV itself
 * @param accent the colour that banner is "about", used for the card wash, the sweep
 *               and the Ambilight while this app is the one being looked at
 */
data class LaunchableApp(
    val label: String,
    val pkg: String,
    val banner: Drawable?,
    val icon: Drawable,
    val accent: Int,
    /** The icon from the app's xxxhdpi resources, so the dock's magnified tile is sharp. */
    val iconHi: Drawable? = null,
    /** Set for a web app: the site [WebAppActivity] opens instead of a package. */
    val url: String? = null,
)

/**
 * The apps the TV itself considers launchable, in the order the user is likeliest to
 * want them. Read fresh on every resume so a newly sideloaded app appears without a
 * relaunch.
 */
object Apps {
    /**
     * The only apps on the drum until "+ Tutte le app" is opened, in this order;
     * everything else follows alphabetically behind them.
     */
    val FAVOURITES = listOf(
        "com.amazon.amazonvideo.livingroom",   // Prime Video
        "com.spotify.tv.android",
        "it.davideghiotto.cassettetv",          // ~/personal/projects/cassette
        "it.davideghiotto.cinema",              // apps/cinema, the Findroid fork (replaces stock Jellyfin)
        "it.davideghiotto.cinema.debug",        // what apps/cinema/apps/android/scripts/tv.sh installs
        "it.davideghiotto.memoriestv",          // apps/memories/tv, the NAS's Immich
    )

    /** Not an app: the card at the end of the drum that shows or hides the rest. */
    const val MORE = "jarvis:more"

    fun isFavourite(app: LaunchableApp) = app.pkg in FAVOURITES

    private const val FALLBACK_ACCENT = 0xFF4DE8F4.toInt()

    fun load(ctx: Context): List<LaunchableApp> {
        val pm = ctx.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        return pm.queryIntentActivities(intent, 0)
            .mapNotNull { info ->
                val pkg = info.activityInfo.packageName
                if (pkg == ctx.packageName) return@mapNotNull null   // never list ourselves
                val banner = runCatching { info.activityInfo.loadBanner(pm) }.getOrNull()
                val icon = runCatching { info.loadIcon(pm) }.getOrNull() ?: return@mapNotNull null
                LaunchableApp(
                    label = info.loadLabel(pm).toString(),
                    pkg = pkg,
                    banner = banner,
                    icon = icon,
                    accent = Ui.dominantColour(banner ?: icon, FALLBACK_ACCENT),
                    iconHi = runCatching {
                        pm.getResourcesForApplication(info.activityInfo.applicationInfo)
                            .getDrawableForDensity(info.iconResource, DisplayMetrics.DENSITY_XXXHIGH, null)
                    }.getOrNull(),
                )
            }
            .sortedWith(
                compareBy(
                    { FAVOURITES.indexOf(it.pkg).let { i -> if (i < 0) Int.MAX_VALUE else i } },
                    { it.label.lowercase() },
                )
            )
    }

    fun launch(ctx: Context, app: LaunchableApp): Boolean {
        app.url?.let { WebApps.open(ctx, app.label, it); return true }
        return launch(ctx, app.pkg)
    }

    /** @return false when the package is not installed or has no launchable activity. */
    fun launch(ctx: Context, pkg: String): Boolean {
        val pm = ctx.packageManager
        val intent = pm.getLeanbackLaunchIntentForPackage(pkg)
            ?: pm.getLaunchIntentForPackage(pkg)
            ?: return false
        ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        return true
    }
}
