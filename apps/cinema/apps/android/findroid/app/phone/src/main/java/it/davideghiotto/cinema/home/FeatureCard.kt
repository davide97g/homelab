package it.davideghiotto.cinema.home

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.painter.ColorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import dev.jdtech.jellyfin.core.R as CoreR
import dev.jdtech.jellyfin.models.FindroidItem
import it.davideghiotto.cinema.design.CinemaColors
import it.davideghiotto.cinema.design.CinemaTokens

/**
 * Cinema — a Findroid fork.
 *
 * One page of the feature band: backdrop, logo art where the server has it, a kind tag, the
 * community rating as a percentage, a dot-separated fact line, and the two actions. apps/web's
 * FeatureCard is the reference; see docs/DESIGN.md in the Cinema monorepo.
 */
@Composable
internal fun FeatureCard(
    item: FindroidItem,
    onPlay: (FindroidItem) -> Unit,
    onDetails: (FindroidItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .aspectRatio(16f / 10f)
                .clip(RoundedCornerShape(CinemaTokens.Radius.xl))
                .clickable { onDetails(item) }
    ) {
        // The artwork and the scrim match the parent rather than measuring
        // themselves: as ordinary siblings a filled image makes the box as wide
        // as the scaled bitmap, which pushes the copy off the screen.
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
                    Brush.verticalGradient(
                        0.0f to CinemaColors.canvas.copy(alpha = 0.1f),
                        0.55f to CinemaColors.canvas.copy(alpha = 0.7f),
                        1.0f to CinemaColors.canvas.copy(alpha = 0.95f),
                    )
            )
        }

        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.align(Alignment.BottomStart).fillMaxWidth(0.72f).padding(16.dp),
        ) {
            KindTag(item)

            val logo = item.images.logo ?: item.images.showLogo
            if (logo != null) {
                AsyncImage(
                    model = logo,
                    contentDescription = item.displayTitle(),
                    contentScale = ContentScale.Fit,
                    alignment = Alignment.CenterStart,
                    modifier = Modifier.fillMaxWidth().heightIn(max = 56.dp),
                )
            } else {
                Text(
                    text = item.displayTitle(),
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    color = CinemaColors.foreground,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                item.matchPercent()?.let { match ->
                    Text(
                        text = stringResource(CoreR.string.cinema_match, match),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                        color = CinemaColors.match,
                    )
                }
                DotSeparatedText(parts = item.factLine())
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (item.isPlayable()) {
                    Button(
                        onClick = { onPlay(item) },
                        colors =
                            ButtonDefaults.buttonColors(
                                containerColor = CinemaColors.primary,
                                contentColor = CinemaColors.onPrimary,
                            ),
                    ) {
                        Icon(
                            painter = painterResource(CoreR.drawable.ic_play),
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Text(
                            text = stringResource(CoreR.string.cinema_play),
                            modifier = Modifier.padding(start = 8.dp),
                        )
                    }
                }
                Button(
                    onClick = { onDetails(item) },
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = CinemaColors.surfaceRaised,
                            contentColor = CinemaColors.foreground,
                        ),
                ) {
                    Icon(
                        painter = painterResource(CoreR.drawable.ic_info),
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Text(
                        text = stringResource(CoreR.string.cinema_details),
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }
        }

        // Only mid-watch items get a bar. 0% and 100% are not progress.
        item.progressFraction()?.let { fraction ->
            Box(
                modifier =
                    Modifier.align(Alignment.BottomStart)
                        .fillMaxWidth(fraction)
                        .height(3.dp)
                        .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
            ) {
                Canvas(modifier = Modifier.matchParentSize()) { drawRect(CinemaColors.primary) }
            }
        }
    }
}

/** A red tick and a word. The tick is Cinema's mark, used at card scale. */
@Composable
internal fun KindTag(item: FindroidItem, modifier: Modifier = Modifier) {
    val label = item.kindLabelRes() ?: return
    Row(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier,
    ) {
        Box(
            modifier =
                Modifier.width(3.dp)
                    .height(12.dp)
                    .clip(RoundedCornerShape(CinemaTokens.Radius.pill))
        ) {
            Canvas(modifier = Modifier.matchParentSize()) { drawRect(CinemaColors.primary) }
        }
        Text(
            text = stringResource(label).uppercase(),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            letterSpacing = 1.4.sp,
            color = CinemaColors.foreground.copy(alpha = 0.7f),
        )
    }
}

/**
 * Metadata as text separated by dots, never as chips. Chips made every card look like a form; the
 * dot line is what a film's credits read like.
 */
@Composable
internal fun DotSeparatedText(parts: List<String>, modifier: Modifier = Modifier) {
    val items = parts.filter { it.isNotBlank() }
    if (items.isEmpty()) return
    Text(
        text = items.joinToString(" · "),
        style = MaterialTheme.typography.labelMedium,
        color = CinemaColors.mutedForeground,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}
