package it.davideghiotto.jarvistv

import android.content.Context
import android.content.Intent
import android.graphics.drawable.Drawable
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

data class LaunchableApp(val label: String, val pkg: String, val icon: Drawable)

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
        "tv.twitch.android.app",
        "it.rainet.androidtv",
        "com.disney.disneyplus",
        "com.google.android.youtube.tv",
    )

    fun load(ctx: Context): List<LaunchableApp> {
        val pm = ctx.packageManager
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER)
        return pm.queryIntentActivities(intent, 0)
            .mapNotNull { info ->
                val pkg = info.activityInfo.packageName
                if (pkg == ctx.packageName) return@mapNotNull null   // never list ourselves
                LaunchableApp(
                    label = info.loadLabel(pm).toString(),
                    pkg = pkg,
                    icon = info.activityInfo.loadBanner(pm)
                        ?: info.loadIcon(pm),
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

class AppsAdapter(
    private val apps: List<LaunchableApp>,
    private val onClick: (LaunchableApp) -> Unit,
) : RecyclerView.Adapter<AppsAdapter.VH>() {

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val icon: ImageView = view.findViewById(R.id.appIcon)
        val label: TextView = view.findViewById(R.id.appLabel)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_app, parent, false)
        (v.layoutParams as RecyclerView.LayoutParams).marginEnd =
            v.resources.getDimensionPixelSize(R.dimen.tile_gap)
        return VH(v)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val app = apps[position]
        holder.icon.setImageDrawable(app.icon)
        holder.label.text = app.label
        holder.itemView.setOnClickListener { onClick(app) }
        // A focused card lifts slightly. Scale only — a shadow costs a layer on a set
        // with 2 GB of RAM and no compositor headroom to spare.
        holder.itemView.setOnFocusChangeListener { v, hasFocus ->
            val s = if (hasFocus) 1.06f else 1f
            v.animate().scaleX(s).scaleY(s).setDuration(120).start()
        }
    }

    override fun getItemCount() = apps.size
}
