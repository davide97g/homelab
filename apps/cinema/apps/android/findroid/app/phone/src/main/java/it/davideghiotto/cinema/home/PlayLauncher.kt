package it.davideghiotto.cinema.home

import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import dev.jdtech.jellyfin.PlayerActivity
import dev.jdtech.jellyfin.models.FindroidEpisode
import dev.jdtech.jellyfin.models.FindroidItem
import dev.jdtech.jellyfin.models.FindroidMovie
import org.jellyfin.sdk.model.api.BaseItemKind

/**
 * Cinema — a Findroid fork.
 *
 * Play from the feature band goes straight to the player rather than by way of the item screen, so
 * the common case is one tap. The extras are the same ones MovieScreen and EpisodeScreen put on the
 * intent; this only saves the caller from repeating them.
 */
@Composable
internal fun rememberPlayLauncher(): (FindroidItem) -> Unit {
    val context = LocalContext.current
    return { item ->
        val kind =
            when (item) {
                is FindroidMovie -> BaseItemKind.MOVIE
                is FindroidEpisode -> BaseItemKind.EPISODE
                else -> null
            }
        if (kind != null) {
            val intent =
                Intent(context, PlayerActivity::class.java).apply {
                    putExtra("itemId", item.id.toString())
                    putExtra("itemKind", kind.serialName)
                    // Resume where it was left, which is the whole point of the
                    // band leading on what you were watching.
                    putExtra("startFromBeginning", false)
                }
            context.startActivity(intent)
        }
    }
}
