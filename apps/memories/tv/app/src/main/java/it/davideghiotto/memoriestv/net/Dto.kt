package it.davideghiotto.memoriestv.net

import it.davideghiotto.memoriestv.data.Asset
import it.davideghiotto.memoriestv.data.Dates
import java.time.Instant
import kotlinx.serialization.Serializable

// Mirrors of the Immich v3.4.0 schemas (apps/memories/spec/immich-openapi-v3.4.0.json), only the
// fields read here. The JSON decoder ignores the rest.

@Serializable data class WellKnownDto(val api: Api) {
    @Serializable data class Api(val endpoint: String)
}

@Serializable data class UserDto(val id: String, val email: String, val name: String)

@Serializable data class BucketDto(val count: Int, val timeBucket: String)

/** `GET /timeline/bucket` is columnar: one array per field, all the same length. */
@Serializable
data class BucketAssetsDto(
    val id: List<String>,
    val ratio: List<Double> = emptyList(),
    val thumbhash: List<String?> = emptyList(),
    val fileCreatedAt: List<String> = emptyList(),
    val localOffsetHours: List<Double> = emptyList(),
    val isImage: List<Boolean> = emptyList(),
    val duration: List<Long?> = emptyList(),
    val isFavorite: List<Boolean> = emptyList(),
    val livePhotoVideoId: List<String?> = emptyList(),
    val city: List<String?>? = null,
    val country: List<String?>? = null,
) {
    fun rows(): List<Asset> = id.indices.map { i ->
        Asset(
            id = id[i],
            ratio = ratio.getOrNull(i)?.toFloat() ?: 1f,
            thumbhash = thumbhash.getOrNull(i),
            isImage = isImage.getOrNull(i) ?: true,
            durationMs = duration.getOrNull(i),
            isFavorite = isFavorite.getOrNull(i) ?: false,
            livePhotoVideoId = livePhotoVideoId.getOrNull(i),
            createdAt = Dates.parse(fileCreatedAt.getOrNull(i)) ?: Instant.EPOCH,
            offsetHours = localOffsetHours.getOrNull(i) ?: 0.0,
            city = city?.getOrNull(i),
            country = country?.getOrNull(i),
        )
    }
}

@Serializable
data class ExifDto(
    val city: String? = null,
    val country: String? = null,
    val description: String? = null,
    val exifImageHeight: Int? = null,
    val exifImageWidth: Int? = null,
    val exposureTime: String? = null,
    val fNumber: Double? = null,
    val fileSizeInByte: Long? = null,
    val focalLength: Double? = null,
    val iso: Int? = null,
    val lensModel: String? = null,
    val make: String? = null,
    val model: String? = null,
)

@Serializable
data class PersonDto(
    val id: String,
    val name: String = "",
    val isHidden: Boolean = false,
)

@Serializable
data class AssetDto(
    val id: String,
    val type: String,
    val originalFileName: String = "",
    val originalMimeType: String? = null,
    val fileCreatedAt: String,
    val localDateTime: String? = null,
    val isFavorite: Boolean = false,
    val thumbhash: String? = null,
    /** Milliseconds. */
    val duration: Long? = null,
    val width: Int? = null,
    val height: Int? = null,
    val livePhotoVideoId: String? = null,
    val exifInfo: ExifDto? = null,
    val people: List<PersonDto>? = null,
) {
    fun asset(): Asset {
        val created = Dates.parse(fileCreatedAt) ?: Instant.EPOCH
        // localDateTime is the wall clock written as if it were UTC.
        val local = Dates.parse(localDateTime) ?: created
        val w = (exifInfo?.exifImageWidth ?: width ?: 1).toFloat()
        val h = (exifInfo?.exifImageHeight ?: height ?: 1).toFloat()
        return Asset(
            id = id,
            ratio = if (h > 0) (w / h).coerceAtLeast(0.1f) else 1f,
            thumbhash = thumbhash,
            isImage = type != "VIDEO",
            durationMs = duration,
            isFavorite = isFavorite,
            livePhotoVideoId = livePhotoVideoId,
            createdAt = created,
            offsetHours = (local.epochSecond - created.epochSecond) / 3600.0,
            city = exifInfo?.city,
            country = exifInfo?.country,
        )
    }
}

@Serializable
data class AlbumDto(
    val id: String,
    val albumName: String,
    val albumThumbnailAssetId: String? = null,
    val assetCount: Int = 0,
    val shared: Boolean = false,
    val startDate: String? = null,
)

@Serializable data class PeopleDto(val people: List<PersonDto> = emptyList())

@Serializable
data class MemoryDto(
    val id: String,
    val type: String,
    val data: Data,
    val assets: List<AssetDto> = emptyList(),
) {
    @Serializable data class Data(val year: Int = 0, val personName: String? = null)
}

@Serializable data class ExploreDto(val fieldName: String, val items: List<Item> = emptyList()) {
    @Serializable data class Item(val value: String, val data: AssetDto)
}

@Serializable
data class SmartSearchDto(val query: String, val size: Int = 100, val page: Int? = null, val withExif: Boolean = false)

@Serializable
data class MetadataSearchDto(
    val type: String? = null,
    val visibility: String? = null,
    val city: String? = null,
    val order: String? = null,
    val size: Int = 250,
    val page: Int? = null,
    val withExif: Boolean = true,
)

@Serializable data class SearchDto(val assets: Items) {
    @Serializable data class Items(val items: List<AssetDto> = emptyList(), val nextPage: String? = null)
}

@Serializable data class FavoriteDto(val ids: List<String>, val isFavorite: Boolean)
