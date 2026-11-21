package it.davideghiotto.memoriestv.net

import it.davideghiotto.memoriestv.data.Album
import it.davideghiotto.memoriestv.data.Asset
import it.davideghiotto.memoriestv.data.AssetDetail
import it.davideghiotto.memoriestv.data.Bucket
import it.davideghiotto.memoriestv.data.Dates
import it.davideghiotto.memoriestv.data.ImageSize
import it.davideghiotto.memoriestv.data.ListQuery
import it.davideghiotto.memoriestv.data.MediaService
import it.davideghiotto.memoriestv.data.Memory
import it.davideghiotto.memoriestv.data.Page
import it.davideghiotto.memoriestv.data.Person
import it.davideghiotto.memoriestv.data.Place
import it.davideghiotto.memoriestv.data.TimelineQuery
import it.davideghiotto.memoriestv.data.User
import it.davideghiotto.memoriestv.data.VideoSource
import java.io.IOException
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

val JsonFormat = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
}

class ImmichException(val status: Int, message: String) : IOException(message)

/**
 * Immich v3.4 over its REST API, with this TV's own token (`Authorization: Bearer`, as the iOS
 * app sends it). [apiBase] is the `/api` root found through `/.well-known/immich`.
 */
class Immich(
    private val http: OkHttpClient,
    private val apiBase: String,
    private val token: String,
    /** Called on a 401: the token was revoked (accounts unlinked this TV). */
    private val onUnauthorized: () -> Unit,
) : MediaService {
    override val isMock = false

    val authHeaders = mapOf("Authorization" to "Bearer $token")

    private fun url(path: String, params: List<Pair<String, String>> = emptyList()): HttpUrl {
        val b = (apiBase.trimEnd('/') + "/" + path).toHttpUrl().newBuilder()
        params.forEach { (k, v) -> b.addQueryParameter(k, v) }
        return b.build()
    }

    private suspend fun call(req: Request): String = withContext(Dispatchers.IO) {
        http.newCall(req.newBuilder().header("Authorization", "Bearer $token").header("Accept", "application/json").build())
            .execute().use { res ->
                val body = res.body.string()
                if (res.code == 401) onUnauthorized()
                if (!res.isSuccessful) {
                    val msg = runCatching { JsonFormat.parseToJsonElement(body).toString() }.getOrNull()
                    throw ImmichException(res.code, if (res.code == 401) "Signed out by the server." else "HTTP ${res.code} ${msg.orEmpty().take(120)}")
                }
                body
            }
    }

    private suspend inline fun <reified T> get(path: String, params: List<Pair<String, String>> = emptyList()): T =
        JsonFormat.decodeFromString(call(Request.Builder().url(url(path, params)).get().build()))

    private suspend inline fun <reified B, reified T> send(method: String, path: String, body: B): T {
        val json = JsonFormat.encodeToString(body).toRequestBody("application/json".toMediaType())
        return JsonFormat.decodeFromString(call(Request.Builder().url(url(path)).method(method, json).build()))
    }

    override suspend fun me(): User {
        val u: UserDto = get("users/me")
        return User(u.id, u.name, u.email)
    }

    override suspend fun buckets(q: TimelineQuery): List<Bucket> =
        get<List<BucketDto>>("timeline/buckets", q.params()).map { Bucket(it.timeBucket, it.count) }

    override suspend fun bucket(q: TimelineQuery, key: String): List<Asset> =
        get<BucketAssetsDto>("timeline/bucket", q.params() + ("timeBucket" to key)).rows()

    override suspend fun detail(id: String): AssetDetail {
        val d: AssetDto = get("assets/$id")
        val e = d.exifInfo
        return AssetDetail(
            asset = d.asset(),
            fileName = d.originalFileName,
            mimeType = d.originalMimeType,
            description = e?.description?.ifBlank { null },
            make = e?.make, model = e?.model, lens = e?.lensModel,
            width = e?.exifImageWidth ?: d.width, height = e?.exifImageHeight ?: d.height,
            fileSize = e?.fileSizeInByte, iso = e?.iso, focalLength = e?.focalLength,
            fNumber = e?.fNumber, exposure = e?.exposureTime,
            people = d.people.orEmpty().filter { !it.isHidden && it.name.isNotBlank() }.map { Person(it.id, it.name) },
        )
    }

    override suspend fun albums(): List<Album> =
        get<List<AlbumDto>>("albums").map {
            Album(it.id, it.albumName, it.albumThumbnailAssetId, it.assetCount, it.shared, Dates.parse(it.startDate))
        }.sortedByDescending { it.start }

    override suspend fun people(): List<Person> =
        get<PeopleDto>("people", listOf("size" to "500")).people
            .filter { !it.isHidden }
            .map { Person(it.id, it.name) }

    override suspend fun memories(): List<Memory> =
        get<List<MemoryDto>>("memories", listOf("for" to LocalDate.now().toString())).mapNotNull { m ->
            val assets = m.assets.map { it.asset() }
            if (assets.isEmpty()) return@mapNotNull null
            val title = if (m.type == "birthday" && m.data.personName != null) "${m.data.personName}'s Birthday" else "On This Day"
            Memory(m.id, m.data.year, title, assets)
        }

    override suspend fun places(): List<Place> {
        val explore: List<ExploreDto> = get("search/explore")
        return explore.firstOrNull { it.fieldName == "exifInfo.city" }?.items.orEmpty().map { Place(it.value, it.data.asset()) }
    }

    override suspend fun list(q: ListQuery, page: Int): Page {
        val res: SearchDto = when (q) {
            is ListQuery.Smart -> send("POST", "search/smart", SmartSearchDto(q.text, page = page))
            ListQuery.Videos -> send("POST", "search/metadata", MetadataSearchDto(type = "VIDEO", visibility = "timeline", order = "desc", page = page))
            ListQuery.RecentlyAdded -> send("POST", "search/metadata", MetadataSearchDto(visibility = "timeline", order = "desc", page = page))
            is ListQuery.City -> send("POST", "search/metadata", MetadataSearchDto(city = q.name, visibility = "timeline", order = "desc", page = page))
        }
        return Page(res.assets.items.map { it.asset() }, res.assets.nextPage?.toIntOrNull())
    }

    override suspend fun setFavorite(ids: List<String>, value: Boolean) {
        val json = JsonFormat.encodeToString(FavoriteDto(ids, value)).toRequestBody("application/json".toMediaType())
        call(Request.Builder().url(url("assets")).put(json).build())
    }

    override fun image(id: String, size: ImageSize, thumbhash: String?): Any =
        url("assets/$id/thumbnail", listOfNotNull("size" to size.param, thumbhash?.let { "c" to it })).toString()

    override fun personImage(id: String): Any = url("people/$id/thumbnail").toString()

    override fun video(id: String): VideoSource = VideoSource(url("assets/$id/video/playback").toString(), authHeaders)

    override suspend fun signOut() {
        runCatching { call(Request.Builder().url(url("auth/logout")).post(ByteArray(0).toRequestBody()).build()) }
    }

    companion object {
        /** `<server>/.well-known/immich` -> `{"api":{"endpoint":"/api"}}`, resolved against the server. */
        suspend fun discover(http: OkHttpClient, server: String): String = withContext(Dispatchers.IO) {
            val base = server.trimEnd('/')
            val req = Request.Builder().url("$base/.well-known/immich").build()
            val endpoint = runCatching {
                http.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) null
                    else JsonFormat.decodeFromString<WellKnownDto>(res.body.string()).api.endpoint
                }
            }.getOrNull() ?: "/api"
            // A relative endpoint is relative to the server URL as given (prefix kept, like the iOS app).
            if (endpoint.startsWith("http")) endpoint.trimEnd('/') else base + "/" + endpoint.trim('/')
        }
    }
}
