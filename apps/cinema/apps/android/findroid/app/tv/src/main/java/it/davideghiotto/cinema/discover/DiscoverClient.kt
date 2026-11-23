package it.davideghiotto.cinema.discover

import dev.jdtech.jellyfin.api.JellyfinApi
import it.davideghiotto.cinema.accounts.AccountsClient
import java.net.HttpURLConnection
import java.net.URL
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Discover talks to accounts, not to Seerr: accounts checks the Jellyfin token this TV already
 * holds, maps it to the same person's Seerr user and asks Seerr on their behalf (apps/accounts,
 * /api/discover). No Seerr sign-in, no Seerr key on the device. apps/web does the same in
 * src/lib/discover.
 */
@Singleton
class DiscoverClient @Inject constructor(private val jellyfinApi: JellyfinApi) {
    class DiscoverException(val status: Int, message: String) : Exception(message)

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    suspend fun me(): DiscoverMe = get("me")

    suspend fun row(row: DiscoverRow): List<DiscoverResult> =
        get<Page<DiscoverResult>>("discover/${row.path}?page=1").results.onlyTitles(row.mediaType)

    suspend fun details(type: String, id: Int): DiscoverDetails = get("$type/$id")

    suspend fun recommendations(type: String, id: Int): List<DiscoverResult> =
        get<Page<DiscoverResult>>("$type/$id/recommendations?page=1").results.onlyTitles(type)

    /** accounts pins this list to the caller: it is always "my requests". */
    suspend fun myRequests(): List<MediaRequest> =
        get<Page<MediaRequest>>("request?take=20&skip=0&sort=added&filter=all").results

    suspend fun request(type: String, id: Int, seasons: List<Int>?) {
        send(
            "POST",
            "request",
            json.encodeToString(NewRequest.serializer(), NewRequest(type, id, seasons)),
        )
    }

    suspend fun cancel(requestId: Int) {
        send("DELETE", "request/$requestId", null)
    }

    private suspend inline fun <reified T> get(path: String): T =
        json.decodeFromString(send("GET", path, null))

    private suspend fun send(method: String, path: String, body: String?): String =
        withContext(Dispatchers.IO) {
            val token =
                jellyfinApi.api.accessToken
                    ?: throw DiscoverException(401, "Not signed in to Jellyfin")
            val conn =
                URL("${AccountsClient.BASE_URL}/api/discover/$path").openConnection()
                    as HttpURLConnection
            try {
                conn.requestMethod = method
                conn.connectTimeout = 10_000
                conn.readTimeout = 20_000
                conn.setRequestProperty("Accept", "application/json")
                conn.setRequestProperty("Authorization", "Bearer $token")
                if (body != null) {
                    conn.doOutput = true
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.outputStream.use { it.write(body.toByteArray()) }
                }
                val status = conn.responseCode
                val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                if (status !in 200..299) {
                    val message = runCatching {
                        json
                            .decodeFromString(JsonObject.serializer(), text)["error"]
                            ?.jsonPrimitive
                            ?.content
                    }
                        .getOrNull()
                    throw DiscoverException(status, message ?: "Discover answered $status")
                }
                text
            } finally {
                conn.disconnect()
            }
        }

    @Serializable
    private data class NewRequest(
        val mediaType: String,
        val mediaId: Int,
        val seasons: List<Int>? = null,
    )
}

/** Seerr's rows don't always say what they hold; the path does. People are not titles. */
private fun List<DiscoverResult>.onlyTitles(fallback: String?): List<DiscoverResult> = map {
    if (it.mediaType == null && fallback != null) it.copy(mediaType = fallback) else it
}
    .filter { it.mediaType == "movie" || it.mediaType == "tv" }
