package it.davideghiotto.cinema.home

import dev.jdtech.jellyfin.film.presentation.home.HomeState
import dev.jdtech.jellyfin.models.FindroidBoxSet
import dev.jdtech.jellyfin.models.FindroidEpisode
import dev.jdtech.jellyfin.models.FindroidItem
import dev.jdtech.jellyfin.models.FindroidMovie
import dev.jdtech.jellyfin.models.FindroidSeason
import dev.jdtech.jellyfin.models.FindroidShow

/**
 * Cinema — a Findroid fork.
 *
 * What the feature band draws from, and the facts it can say about an item. Kept out of the
 * composables so both the band and its card stay about layout.
 */
internal const val FEATURE_BAND_MAX = 5

/**
 * What you were watching leads; the newest suggestions stand in when there is nothing to resume,
 * and Next Up or the first library after that. Every step degrades on its own, which matters
 * because the user can switch the resume row off entirely in settings.
 */
internal fun featureItems(state: HomeState): List<FindroidItem> {
    val candidates =
        listOf(
            state.resumeSection?.homeSection?.items,
            state.suggestionsSection?.items,
            state.nextUpSection?.homeSection?.items,
            state.views.firstOrNull()?.view?.items,
        )
    return candidates.firstOrNull { !it.isNullOrEmpty() }.orEmpty().take(FEATURE_BAND_MAX)
}

/** Jellyfin rates 0-10; everyone reads a percentage. */
internal fun FindroidItem.matchPercent(): Int? {
    val rating =
        when (this) {
            is FindroidMovie -> communityRating
            is FindroidShow -> communityRating
            is FindroidEpisode -> communityRating
            else -> null
        } ?: return null
    return (rating * 10).toInt()
}

/** An episode belongs to its series; that is the name worth showing large. */
internal fun FindroidItem.displayTitle(): String =
    when (this) {
        is FindroidEpisode -> seriesName
        else -> name
    }

/**
 * Year, runtime, rating, one genre — whatever this kind of item actually has. One genre, not a
 * comma list: a card that lists its genres reads like a form.
 */
internal fun FindroidItem.factLine(): List<String> {
    if (this is FindroidEpisode) {
        return listOfNotNull(
            "S$parentIndexNumber",
            "E$indexNumber",
            name.takeIf { it.isNotBlank() },
        )
    }
    val year =
        when (this) {
            is FindroidMovie -> productionYear
            is FindroidShow -> productionYear
            else -> null
        }
    val rating =
        when (this) {
            is FindroidMovie -> officialRating
            is FindroidShow -> officialRating
            else -> null
        }
    val genre =
        when (this) {
            is FindroidMovie -> genres.firstOrNull()
            is FindroidShow -> genres.firstOrNull()
            else -> null
        }
    return listOfNotNull(year?.toString(), runtimeLabel(), rating, genre)
}

/** Jellyfin counts in 100-nanosecond ticks. */
private fun FindroidItem.runtimeLabel(): String? {
    val minutes = runtimeTicks / 600_000_000
    return if (minutes > 0) "${minutes}m" else null
}

/**
 * How far through this item playback genuinely is. Null at 0% and at the end: neither is progress,
 * and a hairline at either reads as damage.
 */
internal fun FindroidItem.progressFraction(): Float? {
    if (runtimeTicks <= 0 || playbackPositionTicks <= 0) return null
    val fraction = playbackPositionTicks.toFloat() / runtimeTicks
    return fraction.takeIf { it > 0.01f && it < 0.99f }
}

/**
 * A series built from a BaseItemDto carries no media sources, so Play on one would fail. Series get
 * Details only.
 */
internal fun FindroidItem.isPlayable(): Boolean =
    canPlay && this !is FindroidShow && this !is FindroidBoxSet

internal fun FindroidItem.kindLabelRes(): Int? =
    when (this) {
        is FindroidMovie -> dev.jdtech.jellyfin.core.R.string.cinema_kind_film
        is FindroidShow -> dev.jdtech.jellyfin.core.R.string.cinema_kind_series
        is FindroidEpisode -> dev.jdtech.jellyfin.core.R.string.cinema_kind_episode
        is FindroidSeason -> dev.jdtech.jellyfin.core.R.string.cinema_kind_season
        is FindroidBoxSet -> dev.jdtech.jellyfin.core.R.string.cinema_kind_collection
        else -> null
    }
