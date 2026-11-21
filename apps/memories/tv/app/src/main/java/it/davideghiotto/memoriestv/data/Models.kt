package it.davideghiotto.memoriestv.data

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** One asset as the grid and viewer see it (same shape as the iOS app's `Asset`). */
data class Asset(
    val id: String,
    val ratio: Float,
    val thumbhash: String?,
    val isImage: Boolean,
    val durationMs: Long?,
    val isFavorite: Boolean,
    val livePhotoVideoId: String?,
    /** UTC instant of capture. */
    val createdAt: Instant,
    /** Hours east of UTC at capture time. */
    val offsetHours: Double,
    val city: String?,
    val country: String?,
) {
    val isVideo get() = !isImage
    val isLivePhoto get() = isImage && livePhotoVideoId != null

    /** Wall-clock capture time. */
    val local: LocalDateTime
        get() = LocalDateTime.ofInstant(createdAt, ZoneOffset.ofTotalSeconds((offsetHours * 3600).toInt()))

    val place: String?
        get() = listOfNotNull(city, country).joinToString(", ").ifEmpty { null }

    val durationText: String?
        get() {
            val ms = durationMs ?: return null
            if (ms <= 0) return null
            val total = Math.round(ms / 1000.0).toInt()
            val h = total / 3600
            val m = (total % 3600) / 60
            val s = total % 60
            return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
        }
}

data class AssetDetail(
    val asset: Asset,
    val fileName: String,
    val mimeType: String?,
    val description: String?,
    val make: String?,
    val model: String?,
    val lens: String?,
    val width: Int?,
    val height: Int?,
    val fileSize: Long?,
    val iso: Int?,
    val focalLength: Double?,
    val fNumber: Double?,
    val exposure: String?,
    val people: List<Person>,
)

data class Album(
    val id: String,
    val name: String,
    val thumbnailAssetId: String?,
    val count: Int,
    val shared: Boolean,
    val start: Instant?,
)

data class Person(val id: String, val name: String)

data class Memory(val id: String, val year: Int, val title: String, val assets: List<Asset>)

data class Place(val name: String, val asset: Asset)

data class User(val id: String, val name: String, val email: String)

/** A month of the timeline: `2024-05-01` plus how many items it holds. */
data class Bucket(val key: String, val count: Int) {
    val month: LocalDate get() = LocalDate.parse(key.take(10))
}

data class Page(val assets: List<Asset>, val nextPage: Int?)

/** Which slice of the library a timeline shows. Newest first: a remote scrolls down. */
sealed interface TimelineQuery {
    data object Library : TimelineQuery
    data object Favorites : TimelineQuery
    data class Album(val id: String) : TimelineQuery
    data class Person(val id: String) : TimelineQuery

    fun params(): List<Pair<String, String>> {
        val p = mutableListOf("order" to "desc")
        when (this) {
            Library -> p += listOf("visibility" to "timeline", "withStacked" to "true")
            Favorites -> p += listOf("visibility" to "timeline", "isFavorite" to "true")
            is Album -> p += "albumId" to id
            is Person -> p += listOf("visibility" to "timeline", "personId" to id)
        }
        return p
    }
}

/** Searches that are not timelines. */
sealed interface ListQuery {
    data class Smart(val text: String) : ListQuery
    data object Videos : ListQuery
    data object RecentlyAdded : ListQuery
    data class City(val name: String) : ListQuery
}

enum class ImageSize(val param: String) { Thumbnail("thumbnail"), Preview("preview"), Fullsize("fullsize") }

object Dates {
    private val monthYear = DateTimeFormatter.ofPattern("LLLL yyyy", Locale.getDefault())
    private val dayMonthYear = DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(Locale.getDefault())
    private val weekday = DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(Locale.getDefault())
    private val time = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(Locale.getDefault())

    fun monthYear(d: LocalDate): String = d.format(monthYear).replaceFirstChar { it.titlecase(Locale.getDefault()) }
    fun dayMonthYear(d: LocalDateTime): String = d.format(dayMonthYear)
    fun weekdayDate(d: LocalDateTime): String = d.format(weekday).replaceFirstChar { it.titlecase(Locale.getDefault()) }
    fun time(d: LocalDateTime): String = d.format(time)

    fun parse(s: String?): Instant? {
        if (s.isNullOrBlank()) return null
        return runCatching { Instant.parse(s) }.getOrNull()
            ?: runCatching { java.time.OffsetDateTime.parse(s).toInstant() }.getOrNull()
            ?: runCatching { LocalDate.parse(s.take(10)).atStartOfDay().toInstant(ZoneOffset.UTC) }.getOrNull()
    }
}
