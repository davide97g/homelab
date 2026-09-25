package it.davideghiotto.cinema.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.jdtech.jellyfin.models.FindroidItem
import it.davideghiotto.cinema.design.CinemaColors
import it.davideghiotto.cinema.design.CinemaTokens

/**
 * Cinema — a Findroid fork.
 *
 * The feature band: the one large card at the top of the home screen, paged on dots, the way
 * apps/web's home screen opens. It carries the same edge padding as the rows below it, so it reads
 * as the first item of one list rather than as a header.
 *
 * Upstream's HomeCarousel is left in place and unused: deleting it would be a conflict on every
 * upstream touch of that file, for no gain.
 */
@Composable
internal fun FeatureBand(
    items: List<FindroidItem>,
    itemsPadding: PaddingValues,
    onPlay: (FindroidItem) -> Unit,
    onDetails: (FindroidItem) -> Unit,
) {
    if (items.isEmpty()) return

    val pagerState = rememberPagerState(pageCount = { items.size })

    Column {
        Box {
            HorizontalPager(state = pagerState, contentPadding = itemsPadding) { page ->
                FeatureCard(item = items[page], onPlay = onPlay, onDetails = onDetails)
            }
            if (items.size > 1) {
                PageDots(
                    count = items.size,
                    current = pagerState.currentPage,
                    modifier =
                        Modifier.align(Alignment.BottomEnd).padding(itemsPadding).padding(16.dp),
                )
            }
        }
    }
}

/** The pager's only control: the artwork is the rest of it. */
@Composable
private fun PageDots(count: Int, current: Int, modifier: Modifier = Modifier) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = modifier) {
        repeat(count) { index ->
            val active = index == current
            Box(
                modifier =
                    Modifier.height(6.dp)
                        .width(if (active) 20.dp else 6.dp)
                        .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
                        .background(
                            if (active) CinemaColors.foreground
                            else CinemaColors.foreground.copy(alpha = 0.3f)
                        )
                        .size(width = if (active) 20.dp else 6.dp, height = 6.dp)
            )
        }
    }
}
