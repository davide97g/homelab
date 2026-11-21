package it.davideghiotto.cinema.accounts

import dev.jdtech.jellyfin.setup.BuildConfig
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * The homelab's sign-in service (apps/accounts in the monorepo). The TV never sees a password: it
 * shows a code, a phone approves it, and accounts hands back this device's own Jellyfin token.
 */
object AccountsClient {
    val BASE_URL: String = BuildConfig.ACCOUNTS_URL
    private const val CLIENT_ID = "cinema-tv"

    data class DeviceCode(
        val deviceCode: String,
        val userCode: String,
        val intervalSeconds: Long,
        val expiresInSeconds: Long,
    ) {
        /** What the QR encodes: the phone opens the Cinema app there, or the web page. */
        val approveUrl: String
            get() = "$BASE_URL/cinema/device?user_code=$userCode"
    }

    sealed interface Poll {
        data class Granted(val sessionToken: String) : Poll

        data object Pending : Poll

        data object SlowDown : Poll

        data object Denied : Poll

        data object Expired : Poll
    }

    data class JellyfinGrant(val accessToken: String, val userId: String, val serverUrl: String)

    class AccountsException(val status: Int, message: String) : Exception(message)

    suspend fun requestDeviceCode(): DeviceCode {
        val json = post("/api/auth/device/code", JSONObject().put("client_id", CLIENT_ID)).ok()
        return DeviceCode(
            deviceCode = json.getString("device_code"),
            userCode = json.getString("user_code"),
            intervalSeconds = json.optLong("interval", 5),
            expiresInSeconds = json.optLong("expires_in", 600),
        )
    }

    suspend fun poll(deviceCode: String): Poll {
        val r =
            post(
                "/api/auth/device/token",
                JSONObject()
                    .put("grant_type", "urn:ietf:params:oauth:grant-type:device_code")
                    .put("device_code", deviceCode)
                    .put("client_id", CLIENT_ID),
            )
        if (r.status in 200..299) return Poll.Granted(r.json.getString("access_token"))
        return when (r.json.optString("error")) {
            "authorization_pending" -> Poll.Pending
            "slow_down" -> Poll.SlowDown
            "access_denied" -> Poll.Denied
            "expired_token" -> Poll.Expired
            else -> throw r.failure()
        }
    }

    /** The broker: an accounts session in, a Jellyfin token for this exact device out. */
    suspend fun jellyfinToken(
        sessionToken: String,
        deviceId: String,
        deviceName: String,
        client: String,
        version: String,
    ): JellyfinGrant {
        val json =
            post(
                    "/api/apps/cinema/token",
                    JSONObject()
                        .put("deviceId", deviceId)
                        .put("deviceName", deviceName)
                        .put("client", client)
                        .put("version", version),
                    bearer = sessionToken,
                )
                .ok()
        return JellyfinGrant(
            accessToken = json.getString("accessToken"),
            userId = json.getString("userId"),
            serverUrl = json.getString("serverUrl"),
        )
    }

    private class Response(val status: Int, val json: JSONObject) {
        fun ok(): JSONObject = if (status in 200..299) json else throw failure()

        fun failure() =
            AccountsException(
                status,
                json.optString("message").ifBlank {
                    json.optString("error_description").ifBlank { "HTTP $status" }
                },
            )
    }

    private suspend fun post(path: String, body: JSONObject, bearer: String? = null): Response =
        withContext(Dispatchers.IO) {
            val conn = URL("$BASE_URL$path").openConnection() as HttpURLConnection
            try {
                conn.requestMethod = "POST"
                conn.connectTimeout = 10_000
                conn.readTimeout = 15_000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Accept", "application/json")
                if (bearer != null) conn.setRequestProperty("Authorization", "Bearer $bearer")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
                val status = conn.responseCode
                val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
                val json = runCatching { JSONObject(text) }.getOrElse { JSONObject() }
                Response(status, json)
            } finally {
                conn.disconnect()
            }
        }
}
