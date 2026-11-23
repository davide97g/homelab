package it.davideghiotto.cinema.discover

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ClickableSurfaceScale
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import dev.jdtech.jellyfin.presentation.theme.spacings
import it.davideghiotto.cinema.design.CinemaColors
import it.davideghiotto.cinema.design.CinemaTokens
import kotlinx.coroutines.delay

/**
 * Cinema — the Discover tab: everything that is not in the library yet, TMDB through Seerr, with a
 * Request button where the library has a Play button. No search here: typing on a remote is the
 * phone's or the web's job.
 */
@Composable
fun DiscoverScreen(
    navigateToItem: (mediaType: String, tmdbId: Int) -> Unit,
    isLoading: (Boolean) -> Unit,
    viewModel: DiscoverViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(true) { viewModel.load() }

    // Your requests' download and NAS-copy progress: every 10 s while something moves, else 60 s.
    LaunchedEffect(state.requests) {
        while (true) {
            val moving = viewModel.checkProgress()
            delay(if (moving) 10_000 else 60_000)
        }
    }
    LaunchedEffect(state.isLoading) { isLoading(state.isLoading) }

    state.error?.let { error ->
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxSize().padding(MaterialTheme.spacings.large),
        ) {
            Text(
                text = "Discover is not available right now",
                style = MaterialTheme.typography.headlineSmall,
            )
            Text(
                text = error,
                style = MaterialTheme.typography.bodyLarge,
                color = CinemaColors.mutedForeground,
            )
        }
        return
    }

    val itemsPadding = PaddingValues(horizontal = MaterialTheme.spacings.large)
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding =
            PaddingValues(
                top = MaterialTheme.spacings.extraSmall,
                bottom = MaterialTheme.spacings.large,
            ),
        verticalArrangement = Arrangement.spacedBy(MaterialTheme.spacings.large),
    ) {
        // What you asked for first, so "did my request go through?" has an answer on the screen.
        if (state.requests.isNotEmpty()) {
            item(key = "requests") {
                DiscoverRowView(
                    title = "Your requests",
                    results = state.requests,
                    itemsPadding = itemsPadding,
                    onClick = navigateToItem,
                    progress = state.progress,
                )
            }
        }
        items(state.rows, key = { it.first.name }) { (row, results) ->
            DiscoverRowView(
                title = row.title,
                results = results,
                itemsPadding = itemsPadding,
                onClick = navigateToItem,
            )
        }
    }
}

@Composable
internal fun DiscoverRowView(
    title: String,
    results: List<DiscoverResult>,
    itemsPadding: PaddingValues,
    onClick: (mediaType: String, tmdbId: Int) -> Unit,
    modifier: Modifier = Modifier,
    progress: Map<String, TitleProgress> = emptyMap(),
) {
    if (results.isEmpty()) return
    Column(modifier = modifier) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(itemsPadding),
        )
        Spacer(modifier = Modifier.height(MaterialTheme.spacings.medium))
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(MaterialTheme.spacings.default),
            contentPadding = itemsPadding,
        ) {
            items(results, key = { "${it.mediaType}-${it.id}" }) { result ->
                DiscoverCard(
                    result = result,
                    onClick = onClick,
                    progress = progress[progressKey(result.mediaType ?: "movie", result.id)],
                )
            }
        }
    }
}

/**
 * A title from TMDB. It looks like a library card on purpose -- one grammar for "a film" -- and
 * adds the one thing a library card never needs: whether it is here, on its way, or not asked for.
 */
@Composable
private fun DiscoverCard(
    result: DiscoverResult,
    onClick: (mediaType: String, tmdbId: Int) -> Unit,
    progress: TitleProgress? = null,
) {
    val type = result.mediaType ?: "movie"
    val shape = RoundedCornerShape(CinemaTokens.Radius.xl)
    Column(modifier = Modifier.width(150.dp)) {
        Surface(
            onClick = { onClick(type, result.id) },
            shape = ClickableSurfaceDefaults.shape(shape = shape),
            border =
                ClickableSurfaceDefaults.border(
                    focusedBorder =
                        Border(BorderStroke(4.dp, CinemaColors.foreground), shape = shape)
                ),
            scale = ClickableSurfaceScale.None,
            colors =
                ClickableSurfaceDefaults.colors(
                    containerColor = CinemaColors.surface,
                    focusedContainerColor = CinemaColors.surface,
                ),
        ) {
            Box(modifier = Modifier.fillMaxWidth().aspectRatio(2f / 3f)) {
                val poster = tmdbImage(result.posterPath, "w342")
                if (poster != null) {
                    AsyncImage(
                        model = poster,
                        placeholder = ColorPainter(CinemaColors.surface),
                        error = ColorPainter(CinemaColors.surface),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.matchParentSize(),
                    )
                } else {
                    Text(
                        text = result.displayTitle,
                        style = MaterialTheme.typography.bodyMedium,
                        color = CinemaColors.mutedForeground,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.align(Alignment.Center).padding(12.dp),
                    )
                }
                StandingBadge(
                    standing = standingOf(result.mediaInfo),
                    modifier = Modifier.align(Alignment.TopEnd).padding(8.dp),
                )
                ProgressSliver(progress)
            }
        }
        Spacer(modifier = Modifier.height(MaterialTheme.spacings.small))
        Text(
            text = result.displayTitle,
            style = MaterialTheme.typography.titleMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text =
                listOfNotNull(if (type == "tv") "Series" else "Film", result.year)
                    .joinToString(" · "),
            style = MaterialTheme.typography.bodyMedium,
            color = CinemaColors.mutedForeground,
            maxLines = 1,
        )
    }
}

/** Nothing for a title nobody asked for: the badge is news, not a default. */
@Composable
internal fun StandingBadge(standing: Standing, modifier: Modifier = Modifier) {
    val label = standing.label ?: return
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier =
            modifier
                .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
                .background(CinemaColors.canvas.copy(alpha = 0.75f))
                .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        Box(
            modifier =
                Modifier.size(6.dp)
                    .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
                    .background(standing.dotColor())
        )
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = CinemaColors.foreground,
        )
    }
}

internal fun Standing.dotColor() =
    when {
        here -> CinemaColors.match
        this == Standing.BLOCKED -> CinemaColors.mutedForeground
        else -> CinemaColors.amber
    }

/** Same mark as the library's KindTag; TMDB has two kinds, so the word is ours. */
@Composable
internal fun TypeTag(type: String, modifier: Modifier = Modifier) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier,
    ) {
        Box(
            modifier =
                Modifier.width(4.dp)
                    .height(16.dp)
                    .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
                    .background(CinemaColors.primary)
        )
        Text(
            text = if (type == "tv") "SERIES" else "FILM",
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.6.sp,
            color = CinemaColors.foreground.copy(alpha = 0.7f),
        )
    }
}
