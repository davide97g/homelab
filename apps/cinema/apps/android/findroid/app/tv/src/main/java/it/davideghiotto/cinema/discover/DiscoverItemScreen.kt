package it.davideghiotto.cinema.discover

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.BringIntoViewSpec
import androidx.compose.foundation.gestures.LocalBringIntoViewSpec
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Border
import androidx.tv.material3.Button
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ClickableSurfaceScale
import androidx.tv.material3.Icon
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import dev.jdtech.jellyfin.core.R as CoreR
import dev.jdtech.jellyfin.presentation.theme.spacings
import it.davideghiotto.cinema.design.CinemaColors
import it.davideghiotto.cinema.design.CinemaTokens
import java.util.Locale
import java.util.UUID
import kotlin.math.abs
import kotlinx.coroutines.delay

/**
 * Cinema — one title from Discover. Watch when the library has it, Request when it does not (per
 * season for a series), Withdraw while your own request still waits for an admin.
 */
@Composable
fun DiscoverItemScreen(
    mediaType: String,
    tmdbId: Int,
    navigateToItem: (mediaType: String, tmdbId: Int) -> Unit,
    navigateToMovie: (itemId: UUID) -> Unit,
    navigateToShow: (itemId: UUID) -> Unit,
    viewModel: DiscoverItemViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(mediaType, tmdbId) { viewModel.load(mediaType, tmdbId) }

    // While it is on its way, ask the pipeline every 10 s; stops once Watch is there.
    val onWay = state.details?.let { onItsWay(it.mediaInfo) } == true
    LaunchedEffect(onWay) {
        while (onWay) {
            viewModel.checkProgress()
            delay(10_000)
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        val details = state.details
        when {
            state.error != null ->
                Text(
                    text = state.error.orEmpty(),
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.align(Alignment.Center),
                )
            details == null ->
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            else ->
                DiscoverItemLayout(
                    type = mediaType,
                    details = details,
                    state = state,
                    onWatch = { id ->
                        if (mediaType == "tv") navigateToShow(id) else navigateToMovie(id)
                    },
                    onRequest = viewModel::request,
                    onWithdraw = viewModel::withdraw,
                    onToggle = viewModel::toggle,
                    onRelated = navigateToItem,
                )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun DiscoverItemLayout(
    type: String,
    details: DiscoverDetails,
    state: DiscoverItemViewModel.State,
    onWatch: (UUID) -> Unit,
    onRequest: () -> Unit,
    onWithdraw: (Int) -> Unit,
    onToggle: (Int) -> Unit,
    onRelated: (mediaType: String, tmdbId: Int) -> Unit,
) {
    val me = state.me
    val standing = standingOf(details.mediaInfo)
    val jellyfinId = details.mediaInfo?.jellyfinId
    val watchable = jellyfinId != null && standing.here
    val seasons = remember(details) { seasonStandings(details.mediaInfo) }
    val requestable = remember(details) { requestable(details) }
    val canAsk = me?.canRequest(type) == true
    val askable =
        canAsk && if (type == "tv") requestable.isNotEmpty() else standing == Standing.NONE
    val ownPending =
        details.mediaInfo?.requests?.firstOrNull {
            it.status == RequestStatus.PENDING && it.requestedBy?.id == me?.id
        }
    val firstButton = remember { FocusRequester() }
    val sidePadding = MaterialTheme.spacings.default * 2

    Box(modifier = Modifier.fillMaxSize()) {
        tmdbImage(details.backdropPath, "w1280")?.let { backdrop ->
            AsyncImage(
                model = backdrop,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize(),
            )
        }
        Canvas(modifier = Modifier.matchParentSize()) {
            drawRect(
                brush =
                    Brush.horizontalGradient(
                        0.0f to CinemaColors.canvas.copy(alpha = 0.95f),
                        0.6f to CinemaColors.canvas.copy(alpha = 0.6f),
                        1.0f to CinemaColors.canvas.copy(alpha = 0.2f),
                    )
            )
            drawRect(
                brush =
                    Brush.verticalGradient(
                        0.5f to Color.Transparent,
                        1.0f to CinemaColors.canvas,
                    )
            )
        }

        // TV lists pivot the focused child to a third of the screen, which pushed the title off
        // the top as soon as Request took focus. Here a child scrolls only when it is out of view.
        CompositionLocalProvider(LocalBringIntoViewSpec provides OnlyWhenHidden) {
            LazyColumn(
                contentPadding = PaddingValues(top = 96.dp, bottom = MaterialTheme.spacings.large),
                verticalArrangement = Arrangement.spacedBy(MaterialTheme.spacings.default),
                modifier = Modifier.fillMaxSize(),
            ) {
                item(key = "header") {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(MaterialTheme.spacings.small),
                        modifier = Modifier.padding(horizontal = sidePadding).width(720.dp),
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            TypeTag(type)
                            StandingBadge(standing)
                        }
                        Text(
                            text = details.displayTitle,
                            style = MaterialTheme.typography.displayMedium,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        details.tagline
                            ?.takeIf { it.isNotBlank() }
                            ?.let {
                                Text(
                                    text = it,
                                    style = MaterialTheme.typography.bodyLarge,
                                    fontStyle = FontStyle.Italic,
                                    color = CinemaColors.foreground.copy(alpha = 0.6f),
                                )
                            }
                        FactLine(type, details)
                        details.overview
                            ?.takeIf { it.isNotBlank() }
                            ?.let {
                                Text(
                                    text = it,
                                    style = MaterialTheme.typography.bodyMedium,
                                    maxLines = 4,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.width(640.dp),
                                )
                            }
                        Spacer(modifier = Modifier.height(MaterialTheme.spacings.small))
                        Row(
                            horizontalArrangement =
                                Arrangement.spacedBy(MaterialTheme.spacings.medium)
                        ) {
                            // Focus lands on the first action there is, whichever that is.
                            val lead =
                                when {
                                    watchable -> "watch"
                                    askable -> "request"
                                    ownPending != null -> "withdraw"
                                    else -> null
                                }
                            fun Modifier.leading(action: String): Modifier =
                                if (action == lead) focusRequester(firstButton) else this
                            if (watchable) {
                                Button(
                                    onClick = { jellyfinId?.let(onWatch) },
                                    modifier = Modifier.leading("watch"),
                                ) {
                                    Icon(
                                        painterResource(CoreR.drawable.ic_play),
                                        contentDescription = null,
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text("Watch")
                                }
                            }
                            if (askable) {
                                Button(
                                    onClick = onRequest,
                                    enabled =
                                        !state.isBusy &&
                                            (type != "tv" || state.picked.isNotEmpty()),
                                    modifier = Modifier.leading("request"),
                                ) {
                                    Icon(
                                        painterResource(CoreR.drawable.ic_plus),
                                        contentDescription = null,
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        when {
                                            state.isBusy -> "Requesting…"
                                            type != "tv" -> "Request"
                                            state.picked.size == requestable.size &&
                                                seasons.isEmpty() -> "Request series"
                                            state.picked.size == 1 -> "Request 1 season"
                                            else -> "Request ${state.picked.size} seasons"
                                        }
                                    )
                                }
                            }
                            if (ownPending != null) {
                                Button(
                                    onClick = { onWithdraw(ownPending.id) },
                                    enabled = !state.isBusy,
                                    modifier = Modifier.leading("withdraw"),
                                ) {
                                    Icon(
                                        painterResource(CoreR.drawable.ic_x),
                                        contentDescription = null,
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text("Withdraw request")
                                }
                            }
                        }
                        if (me != null && !canAsk && standing == Standing.NONE) {
                            Text(
                                text =
                                    "Your account cannot request " +
                                        if (type == "tv") "series." else "films.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = CinemaColors.mutedForeground,
                            )
                        }
                        state.message?.let {
                            Text(
                                text = it,
                                style = MaterialTheme.typography.bodyLarge,
                                color = CinemaColors.foreground,
                            )
                        }
                        // A partly-there series shows it only while a season is actually moving.
                        val onWay = onItsWay(details.mediaInfo)
                        if ((onWay && standing != Standing.PARTIAL) || state.progress != null) {
                            PipelineProgress(
                                standing = standing,
                                progress = state.progress,
                                modifier = Modifier.padding(top = MaterialTheme.spacings.small),
                            )
                        }
                    }
                }

                if (type == "tv" && details.realSeasons.isNotEmpty()) {
                    item(key = "seasons-title") {
                        Text(
                            text = "Seasons",
                            style = MaterialTheme.typography.headlineSmall,
                            modifier = Modifier.padding(horizontal = sidePadding),
                        )
                    }
                    items(details.realSeasons, key = { "season-${it.seasonNumber}" }) { season ->
                        SeasonRow(
                            season = season,
                            standing = seasons[season.seasonNumber],
                            selectable = askable,
                            picked = season.seasonNumber in state.picked,
                            onToggle = { onToggle(season.seasonNumber) },
                            modifier = Modifier.padding(horizontal = sidePadding),
                        )
                    }
                }

                details.credits
                    ?.cast
                    ?.takeIf { it.isNotEmpty() }
                    ?.let { cast ->
                        item(key = "cast") {
                            Column(
                                modifier = Modifier.padding(horizontal = sidePadding).width(720.dp)
                            ) {
                                Text(
                                    text = "Cast",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = CinemaColors.mutedForeground,
                                )
                                Text(
                                    text = cast.take(8).joinToString { it.name },
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                            }
                        }
                    }

                item(key = "related") {
                    DiscoverRowView(
                        title = "More like this",
                        results = state.related,
                        itemsPadding = PaddingValues(horizontal = sidePadding),
                        onClick = onRelated,
                    )
                }
            }
        }
    }

    LaunchedEffect(watchable, askable, ownPending != null) {
        runCatching { firstButton.requestFocus() }
    }
}

@OptIn(ExperimentalFoundationApi::class)
private val OnlyWhenHidden =
    object : BringIntoViewSpec {
        override fun calculateScrollDistance(
            offset: Float,
            size: Float,
            containerSize: Float,
        ): Float {
            val trailing = offset + size
            return when {
                offset >= 0 && trailing <= containerSize -> 0f
                offset < 0 && trailing > containerSize -> 0f
                abs(offset) < abs(trailing - containerSize) -> offset
                else -> trailing - containerSize
            }
        }
    }

@Composable
private fun FactLine(type: String, details: DiscoverDetails) {
    val facts = buildList {
        add(details.year)
        if (type == "tv") {
            details.numberOfSeasons?.let { add(if (it == 1) "1 season" else "$it seasons") }
        } else {
            details.runtime
                ?.takeIf { it > 0 }
                ?.let { add(if (it >= 60) "${it / 60}h ${it % 60}m" else "${it}m") }
        }
        addAll(details.genres.take(3).map { it.name })
    }
        .filterNotNull()
        .filter { it.isNotBlank() }
    Row(
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        details.voteAverage
            ?.takeIf { it > 0 }
            ?.let {
                Text(
                    text = String.format(Locale.ROOT, "%.1f TMDB", it),
                    style = MaterialTheme.typography.labelLarge,
                    color = CinemaColors.match,
                )
            }
        if (facts.isNotEmpty()) {
            Text(
                text = facts.joinToString(" · "),
                style = MaterialTheme.typography.labelLarge,
                color = CinemaColors.mutedForeground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** A season you can still ask for toggles; one already here or on its way just says so. */
@Composable
private fun SeasonRow(
    season: TvSeason,
    standing: Standing?,
    selectable: Boolean,
    picked: Boolean,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val free = standing == null && selectable
    val shape = RoundedCornerShape(CinemaTokens.Radius.lg)
    Surface(
        onClick = onToggle,
        enabled = free,
        shape = ClickableSurfaceDefaults.shape(shape = shape),
        border =
            ClickableSurfaceDefaults.border(
                focusedBorder = Border(BorderStroke(2.dp, CinemaColors.foreground), shape = shape)
            ),
        scale = ClickableSurfaceScale.None,
        colors =
            ClickableSurfaceDefaults.colors(
                containerColor = Color.Transparent,
                focusedContainerColor = CinemaColors.surface,
                disabledContainerColor = Color.Transparent,
                contentColor = CinemaColors.foreground,
                focusedContentColor = CinemaColors.foreground,
                disabledContentColor = CinemaColors.foreground,
            ),
        modifier = modifier.width(720.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            val checked = standing?.here == true || (free && picked)
            val fill =
                when {
                    standing?.here == true -> CinemaColors.match
                    free && picked -> CinemaColors.primary
                    else -> Color.Transparent
                }
            Box(
                contentAlignment = Alignment.Center,
                modifier =
                    Modifier.size(18.dp)
                        .background(fill, RoundedCornerShape(CinemaTokens.Radius.sm))
                        .border(
                            1.dp,
                            if (checked) fill else CinemaColors.foreground.copy(alpha = 0.3f),
                            RoundedCornerShape(CinemaTokens.Radius.sm),
                        ),
            ) {
                if (checked) {
                    Icon(
                        painterResource(CoreR.drawable.ic_check),
                        contentDescription = null,
                        tint = CinemaColors.foreground,
                        modifier = Modifier.size(12.dp),
                    )
                }
            }
            Text(text = season.name, style = MaterialTheme.typography.titleSmall)
            Text(
                text =
                    listOfNotNull(
                            if (season.episodeCount == 1) "1 episode"
                            else "${season.episodeCount} episodes",
                            season.airDate?.take(4),
                        )
                        .joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = CinemaColors.mutedForeground,
            )
            Spacer(modifier = Modifier.weight(1f))
            standing?.let {
                Text(
                    text =
                        when (it) {
                            Standing.PROCESSING -> "Downloading"
                            Standing.PENDING -> "Awaiting approval"
                            else -> "In library"
                        },
                    style = MaterialTheme.typography.bodySmall,
                    color = CinemaColors.mutedForeground,
                )
            }
        }
    }
}
