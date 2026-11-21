package it.davideghiotto.memoriestv.data

/** A video URL plus the headers it needs (the token). */
data class VideoSource(val url: String, val headers: Map<String, String>)

/**
 * Everything the screens need from a server. [it.davideghiotto.memoriestv.net.Immich] talks to
 * the NAS; [MockService] draws a fake library for the emulator (`--ez mock true`).
 */
interface MediaService {
    val isMock: Boolean

    suspend fun me(): User
    suspend fun buckets(q: TimelineQuery): List<Bucket>
    suspend fun bucket(q: TimelineQuery, key: String): List<Asset>
    suspend fun detail(id: String): AssetDetail

    suspend fun albums(): List<Album>
    suspend fun people(): List<Person>
    suspend fun memories(): List<Memory>
    suspend fun places(): List<Place>

    suspend fun list(q: ListQuery, page: Int): Page
    suspend fun setFavorite(ids: List<String>, value: Boolean)

    /** A Coil model for this asset's rendition. */
    fun image(id: String, size: ImageSize, thumbhash: String? = null): Any
    fun personImage(id: String): Any
    fun video(id: String): VideoSource?

    suspend fun signOut() {}
}
