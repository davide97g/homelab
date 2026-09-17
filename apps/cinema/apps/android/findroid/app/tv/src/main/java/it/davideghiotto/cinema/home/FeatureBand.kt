package it.davideghiotto.cinema.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Border
import androidx.tv.material3.ClickableSurfaceDefaults
import androidx.tv.material3.ClickableSurfaceScale
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Surface
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import dev.jdtech.jellyfin.core.R as CoreR
import dev.jdtech.jellyfin.models.FindroidItem
import it.davideghiotto.cinema.design.CinemaColors
import it.davideghiotto.cinema.design.CinemaTokens

/**
 * Cinema — a Findroid fork.
 *
 * The TV feature band. Same idea as the phone's, and deliberately not the same code: this one is a
 * tv-material3 Surface driven by DPAD focus rather than a Material 3 card driven by taps, and the
 * two component sets do not mix.
 *
 * The whole card is the control. There are no buttons on it: on a remote, one focusable thing that
 * plays is better than two that need a sideways press to choose between.
 */
@Composable
internal fun FeatureBand(
    items: List<FindroidItem>,
    onSelect: (FindroidItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (items.isEmpty()) return

    val pagerState = rememberPagerState(pageCount = { items.size })

    Box(modifier = modifier) {
        HorizontalPager(state = pagerState) { page ->
            FeatureCard(item = items[page], onSelect = onSelect)
        }
        if (items.size > 1) {
            PageDots(
                count = items.size,
                current = pagerState.currentPage,
                modifier = Modifier.align(Alignment.BottomEnd).padding(24.dp),
            )
        }
    }
}

@Composable
private fun FeatureCard(item: FindroidItem, onSelect: (FindroidItem) -> Unit) {
    Surface(
        onClick = { onSelect(item) },
        shape = ClickableSurfaceDefaults.shape(shape = RoundedCornerShape(CinemaTokens.Radius.xl)),
        border =
            ClickableSurfaceDefaults.border(
                // The focus ring has to carry on near-black, so it is the one
                // border in the system drawn at full strength.
                focusedBorder =
                    Border(
                        BorderStroke(4.dp, CinemaColors.foreground),
                        shape = RoundedCornerShape(CinemaTokens.Radius.xl),
                    )
            ),
        scale = ClickableSurfaceScale.None,
        colors =
            ClickableSurfaceDefaults.colors(
                containerColor = CinemaColors.surface,
                focusedContainerColor = CinemaColors.surface,
                contentColor = CinemaColors.foreground,
                focusedContentColor = CinemaColors.foreground,
            ),
    ) {
        Box(modifier = Modifier.fillMaxWidth().aspectRatio(16f / 7f)) {
            // matchParentSize, so the artwork can never widen the card and push
            // the copy out of frame.
            AsyncImage(
                model = item.images.backdrop ?: item.images.showBackdrop,
                placeholder = ColorPainter(CinemaColors.surface),
                error = ColorPainter(CinemaColors.surface),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.matchParentSize(),
            )
            Canvas(modifier = Modifier.matchParentSize()) {
                drawRect(
                    brush =
                        Brush.horizontalGradient(
                            0.0f to CinemaColors.canvas.copy(alpha = 0.92f),
                            0.55f to CinemaColors.canvas.copy(alpha = 0.55f),
                            1.0f to CinemaColors.canvas.copy(alpha = 0.1f),
                        )
                )
            }

            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.align(Alignment.CenterStart).width(640.dp).padding(40.dp),
            ) {
                KindTag(item)

                val logo = item.images.logo ?: item.images.showLogo
                if (logo != null) {
                    AsyncImage(
                        model = logo,
                        contentDescription = item.displayTitle(),
                        contentScale = ContentScale.Fit,
                        alignment = Alignment.CenterStart,
                        modifier = Modifier.fillMaxWidth().heightIn(max = 96.dp),
                    )
                } else {
                    Text(
                        text = item.displayTitle(),
                        style = MaterialTheme.typography.displaySmall,
                        color = CinemaColors.foreground,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    item.matchPercent()?.let { match ->
                        Text(
                            text = stringResource(CoreR.string.cinema_match, match),
                            style = MaterialTheme.typography.labelLarge,
                            color = CinemaColors.match,
                        )
                    }
                    val facts = item.factLine().filter { it.isNotBlank() }
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

            item.progressFraction()?.let { fraction ->
                Box(
                    modifier =
                        Modifier.align(Alignment.BottomStart)
                            .fillMaxWidth(fraction)
                            .height(4.dp)
                            .background(CinemaColors.primary)
                )
            }
        }
    }
}

@Composable
private fun KindTag(item: FindroidItem, modifier: Modifier = Modifier) {
    val label = item.kindLabelRes() ?: return
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
            text = stringResource(label).uppercase(),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.6.sp,
            color = CinemaColors.foreground.copy(alpha = 0.7f),
        )
    }
}

@Composable
private fun PageDots(count: Int, current: Int, modifier: Modifier = Modifier) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = modifier) {
        repeat(count) { index ->
            val active = index == current
            Box(
                modifier =
                    Modifier.height(8.dp)
                        .width(if (active) 26.dp else 8.dp)
                        .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
                        .background(
                            if (active) CinemaColors.foreground
                            else CinemaColors.foreground.copy(alpha = 0.3f)
                        )
            )
        }
    }
}
