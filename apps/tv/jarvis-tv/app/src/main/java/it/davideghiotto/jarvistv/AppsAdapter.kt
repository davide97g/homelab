package it.davideghiotto.jarvistv

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.drawable.Drawable
import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView

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
)

/**
 * The apps the TV itself considers launchable, in the order the user is likeliest to
 * want them. Read fresh on every resume so a newly sideloaded app appears without a
 * relaunch.
 */
object Apps {
    /** Pinned first, in this order; everything else follows alphabetically. */
    private val FAVOURITES = listOf(
        "org.jellyfin.androidtv",
        "com.spotify.tv.android",
        "com.netflix.ninja",
        "tv.twitch.android.app",
        "it.rainet.androidtv",
        "com.disney.disneyplus",
        "com.amazon.amazonvideo.livingroom",
        "com.google.android.youtube.tv",
    )

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
                )
            }
            .sortedWith(
                compareBy(
                    { FAVOURITES.indexOf(it.pkg).let { i -> if (i < 0) Int.MAX_VALUE else i } },
                    { it.label.lowercase() },
                )
            )
    }

    fun launch(ctx: Context, app: LaunchableApp) = launch(ctx, app.pkg)

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

/**
 * The rail. Selection is this launcher's own state rather than Android focus: with the
 * cards drawn by one custom view each, driving the sweep, the showcase and the hero off
 * a focus search that a RecyclerView can re-run at any moment is more moving parts than
 * the screen needs.
 */
class AppsAdapter(
    private val apps: List<LaunchableApp>,
) : RecyclerView.Adapter<AppsAdapter.VH>() {

    class VH(val card: AppCardView) : RecyclerView.ViewHolder(card)

    var selected = 0
        set(value) {
            if (field == value) return
            val old = field
            field = value
            notifyItemChanged(old)
            notifyItemChanged(value)
        }

    /** Artwork and resume state the server knows about, by package. */
    var art: Map<String, Bitmap> = emptyMap()
    var progress: Map<String, Float> = emptyMap()

    var sweepAngle = 0f

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val card = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_app, parent, false) as AppCardView
        (card.layoutParams as RecyclerView.LayoutParams).marginEnd =
            card.resources.getDimensionPixelSize(R.dimen.card_gap)
        return VH(card)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val app = apps[position]
        val card = holder.card
        card.label = app.label
        card.icon = app.icon
        card.accent = app.accent
        card.art = art[app.pkg] ?: Ui.toBitmap(app.banner, 320, 180)
        card.progress = progress[app.pkg] ?: 0f
        card.badge = if ((progress[app.pkg] ?: 0f) > 0f) card.context.getString(R.string.resume_badge) else null
        card.picked = position == selected
        card.sweepAngle = sweepAngle
        // A picked card lifts slightly. Scale only — a shadow costs a layer on a set
        // with 2 GB of RAM and no compositor headroom to spare.
        val lift = if (card.picked) 1.07f else 1f
        card.animate().scaleX(lift).scaleY(lift)
            .translationY(if (card.picked) -Ui.px(card, 10f) else 0f)
            .setDuration(340).start()
    }

    override fun getItemCount() = apps.size
}
