package it.davideghiotto.cinema.discover

import java.util.UUID
import kotlinx.serialization.Serializable

/**
 * The parts of Seerr's API that Discover reads, as accounts relays them. Seerr answers in the
 * server's locale, Italian. Every field has a default: Seerr leaves out what it does not know.
 */
@Serializable data class Page<T>(val results: List<T> = emptyList())

@Serializable data class SeasonStatus(val seasonNumber: Int = 0, val status: Int = 1)

@Serializable data class RequestedBy(val id: Int = 0)

@Serializable
data class MediaRequest(
    val id: Int,
    val status: Int = 1,
    val type: String = "movie",
    val seasons: List<SeasonStatus> = emptyList(),
    val media: MediaInfo? = null,
    val requestedBy: RequestedBy? = null,
)

@Serializable
data class MediaInfo(
    val tmdbId: Int? = null,
    val status: Int = MediaStatus.UNKNOWN,
    /** The NAS Jellyfin's item id once it is there, as 32 hex digits without dashes. */
    val jellyfinMediaId: String? = null,
    val seasons: List<SeasonStatus> = emptyList(),
    val requests: List<MediaRequest> = emptyList(),
) {
    val jellyfinId: UUID?
        get() =
            jellyfinMediaId
                ?.takeIf { it.length == 32 }
                ?.let {
                    runCatching {
                        UUID.fromString(
                            "${it.substring(0, 8)}-${it.substring(8, 12)}-" +
                                "${it.substring(12, 16)}-${it.substring(16, 20)}-" +
                                it.substring(20)
                        )
                    }
                        .getOrNull()
                }
}

/** A card in a row. */
@Serializable
data class DiscoverResult(
    val id: Int,
    val mediaType: String? = null,
    val title: String? = null,
    val name: String? = null,
    val releaseDate: String? = null,
    val firstAirDate: String? = null,
    val posterPath: String? = null,
    val mediaInfo: MediaInfo? = null,
) {
    val displayTitle: String
        get() = title ?: name ?: ""

    val year: String?
        get() = (releaseDate ?: firstAirDate)?.take(4)?.takeIf { it.isNotBlank() }
}

@Serializable data class Genre(val name: String = "")

@Serializable data class CastMember(val name: String = "")

@Serializable data class Credits(val cast: List<CastMember> = emptyList())

@Serializable
data class TvSeason(
    val id: Int = 0,
    val seasonNumber: Int = 0,
    val name: String = "",
    val episodeCount: Int = 0,
    val airDate: String? = null,
)

/** A film or a series: Seerr answers both with one shape, give or take a field. */
@Serializable
data class DiscoverDetails(
    val id: Int,
    val title: String? = null,
    val name: String? = null,
    val releaseDate: String? = null,
    val firstAirDate: String? = null,
    val overview: String? = null,
    val tagline: String? = null,
    val posterPath: String? = null,
    val backdropPath: String? = null,
    val voteAverage: Double? = null,
    val genres: List<Genre> = emptyList(),
    val runtime: Int? = null,
    val numberOfSeasons: Int? = null,
    val seasons: List<TvSeason> = emptyList(),
    val credits: Credits? = null,
    val mediaInfo: MediaInfo? = null,
) {
    val displayTitle: String
        get() = title ?: name ?: ""

    val year: String?
        get() = (releaseDate ?: firstAirDate)?.take(4)?.takeIf { it.isNotBlank() }

    /** Season 0 is TMDB's "Specials": Sonarr rarely finds them, so they are not offered. */
    val realSeasons: List<TvSeason>
        get() = seasons.filter { it.seasonNumber > 0 }

    fun asResult(type: String) =
        DiscoverResult(
            id = id,
            mediaType = type,
            title = title,
            name = name,
            releaseDate = releaseDate,
            firstAirDate = firstAirDate,
            posterPath = posterPath,
            mediaInfo = mediaInfo,
        )
}

@Serializable data class Kinds(val movie: Boolean = false, val tv: Boolean = false)

@Serializable
data class DiscoverMe(
    val id: Int,
    val displayName: String = "",
    val canRequest: Kinds = Kinds(),
    val autoApprove: Kinds = Kinds(),
) {
    fun canRequest(type: String) = if (type == "tv") canRequest.tv else canRequest.movie

    fun autoApproved(type: String) = if (type == "tv") autoApprove.tv else autoApprove.movie
}

/** Seerr's MediaStatus. */
object MediaStatus {
    const val UNKNOWN = 1
    const val PENDING = 2
    const val PROCESSING = 3
    const val PARTIALLY_AVAILABLE = 4
    const val AVAILABLE = 5
    const val BLOCKLISTED = 6
}

/** Seerr's MediaRequestStatus. */
object RequestStatus {
    const val PENDING = 1
    const val APPROVED = 2
}

enum class DiscoverRow(val path: String, val mediaType: String?, val title: String) {
    TRENDING("trending", null, "Trending this week"),
    MOVIES("movies", "movie", "Popular films"),
    TV("tv", "tv", "Popular series"),
    MOVIES_UPCOMING("movies/upcoming", "movie", "Coming to cinemas"),
    TV_UPCOMING("tv/upcoming", "tv", "New series on the way"),
}

/** Where a title stands for the person looking at it, in the words the UI uses. */
enum class Standing(val label: String?) {
    AVAILABLE("In library"),
    PARTIAL("Partly in library"),
    PROCESSING("Downloading"),
    PENDING("Awaiting approval"),
    BLOCKED("Unavailable"),
    NONE(null);

    val here: Boolean
        get() = this == AVAILABLE || this == PARTIAL
}

fun standingOf(info: MediaInfo?): Standing =
    when (info?.status) {
        MediaStatus.AVAILABLE -> Standing.AVAILABLE
        MediaStatus.PARTIALLY_AVAILABLE -> Standing.PARTIAL
        MediaStatus.PROCESSING -> Standing.PROCESSING
        MediaStatus.PENDING -> Standing.PENDING
        MediaStatus.BLOCKLISTED -> Standing.BLOCKED
        else -> Standing.NONE
    }

/**
 * Per season, what is already on its way or there. A season counts as taken if the media says so or
 * if a live request (pending or approved) names it; only the rest can still be asked for.
 */
fun seasonStandings(info: MediaInfo?): Map<Int, Standing> {
    val out = mutableMapOf<Int, Standing>()
    for (s in info?.seasons.orEmpty()) {
        when (s.status) {
            MediaStatus.AVAILABLE,
            MediaStatus.PARTIALLY_AVAILABLE -> out[s.seasonNumber] = Standing.AVAILABLE
            MediaStatus.PROCESSING -> out[s.seasonNumber] = Standing.PROCESSING
            MediaStatus.PENDING -> out[s.seasonNumber] = Standing.PENDING
        }
    }
    for (r in info?.requests.orEmpty()) {
        val live =
            when (r.status) {
                RequestStatus.PENDING -> Standing.PENDING
                RequestStatus.APPROVED -> Standing.PROCESSING
                else -> continue
            }
        for (s in r.seasons) out.putIfAbsent(s.seasonNumber, live)
    }
    return out
}

/** TMDB serves Seerr's artwork; sizes are TMDB's fixed widths. */
fun tmdbImage(path: String?, size: String): String? = path?.let {
    "https://image.tmdb.org/t/p/$size$it"
}
