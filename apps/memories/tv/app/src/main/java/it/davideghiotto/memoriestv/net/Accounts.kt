package it.davideghiotto.memoriestv.net

import it.davideghiotto.memoriestv.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * The homelab's sign-in service (apps/accounts). The TV never sees a password: it shows a code and
 * a QR, the Memories app on a phone approves it, and accounts hands back this TV's own Immich
 * token. Same flow as Cinema's Findroid TV (`cinema-tv`), with client `memories-tv`.
 */
class Accounts(private val http: OkHttpClient, val base: String = BuildConfig.ACCOUNTS_URL) {
    data class DeviceCode(val deviceCode: String, val userCode: String, val intervalSeconds: Long, val expiresInSeconds: Long)

    sealed interface Poll {
        data class Granted(val sessionToken: String) : Poll
        data object Pending : Poll
        data object SlowDown : Poll
        data object Gone : Poll
    }

    data class Grant(val accessToken: String, val userId: String, val serverUrl: String)

    class AccountsException(val status: Int, message: String) : Exception(message)

    /** The QR: opens Memories on the iPhone (universal link), or the web approval page. */
    fun approveUrl(userCode: String) = "$base/memories/device?user_code=$userCode"

    suspend fun requestCode(): DeviceCode {
        val j = post("/api/auth/device/code", buildJsonObject { put("client_id", CLIENT_ID) }).ok()
        return DeviceCode(
            deviceCode = j.str("device_code")!!,
            userCode = j.str("user_code")!!,
            intervalSeconds = j["interval"]?.jsonPrimitive?.longOrNull ?: 5,
            expiresInSeconds = j["expires_in"]?.jsonPrimitive?.longOrNull ?: 600,
        )
    }

    suspend fun poll(deviceCode: String): Poll {
        val r = post("/api/auth/device/token", buildJsonObject {
            put("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
            put("device_code", deviceCode)
            put("client_id", CLIENT_ID)
        })
        if (r.status in 200..299) return Poll.Granted(r.json.str("access_token")!!)
        return when (r.json.str("error")) {
            "authorization_pending" -> Poll.Pending
            "slow_down" -> Poll.SlowDown
            "access_denied", "expired_token" -> Poll.Gone
            else -> throw r.failure()
        }
    }

    /** The broker: an accounts session in, an Immich token for this exact TV out. */
    suspend fun immichToken(session: String, deviceId: String, deviceName: String, version: String): Grant {
        val j = post("/api/apps/memories/token", buildJsonObject {
            put("deviceId", deviceId)
            put("deviceName", deviceName)
            put("client", "Memories TV")
            put("version", version)
        }, bearer = session).ok()
        return Grant(j.str("accessToken")!!, j.str("userId").orEmpty(), j.str("serverUrl")!!)
    }

    private class Response(val status: Int, val json: JsonObject) {
        fun ok(): JsonObject = if (status in 200..299) json else throw failure()
        fun failure() = AccountsException(
            status,
            json.str("message") ?: json.str("error_description") ?: "HTTP $status",
        )
    }

    private suspend fun post(path: String, body: JsonObject, bearer: String? = null): Response = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url(base + path)
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .header("Accept", "application/json")
            .apply { if (bearer != null) header("Authorization", "Bearer $bearer") }
            .build()
        http.newCall(req).execute().use { res ->
            val text = res.body.string()
            val json = runCatching { JsonFormat.parseToJsonElement(text) as JsonObject }.getOrElse { JsonObject(emptyMap()) }
            Response(res.code, json)
        }
    }

    private companion object {
        const val CLIENT_ID = "memories-tv"
    }
}

private fun JsonObject.str(key: String): String? =
    (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
