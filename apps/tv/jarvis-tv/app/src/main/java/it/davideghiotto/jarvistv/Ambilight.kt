package it.davideghiotto.jarvistv

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.sin

/**
 * Drives the set's own Ambilight through JointSpace.
 *
 * The TV serves that API to itself on 127.0.0.1:1925 and — unlike port 1926, which
 * demands digest pairing — the plain-HTTP port accepts writes under /6/ambilight with
 * no credentials at all. So this needs no auth key, no pairing, and keeps working
 * after a factory reset.
 *
 * Whatever the viewer had set is captured once at startup and put back after every
 * pulse, because taking over Ambilight and not giving it back is the fastest way to
 * make a launcher feel broken.
 */
class Ambilight(private val scope: CoroutineScope) {

    private val http = OkHttpClient.Builder()
        .connectTimeout(2, TimeUnit.SECONDS)
        .readTimeout(2, TimeUnit.SECONDS)
        .build()

    private var savedMode: String? = null
    private var savedConfig: JSONObject? = null
    private var pulseJob: Job? = null

    /** Remember the viewer's settings so a pulse can hand them back. */
    fun capture() = scope.launch(Dispatchers.IO) {
        savedMode = get("ambilight/mode")?.optString("current")
        savedConfig = get("ambilight/currentconfiguration")
        Log.i(TAG, "captured mode=$savedMode config=$savedConfig")
    }

    /**
     * Breathe the accent colour while JARVIS talks. Cancel it with [stopPulse]; the
     * previous state is restored there, not here, so a cancelled pulse still cleans up.
     */
    fun startPulse(r: Int = 0x4D, g: Int = 0xE8, b: Int = 0xF4) {
        stopPulse(restore = false)
        pulseJob = scope.launch(Dispatchers.IO) {
            post("ambilight/mode", JSONObject().put("current", "manual"))
            var t = 0.0
            while (isActive) {
                // 0.35..1.0 — never fully dark, so the wall does not strobe.
                val k = 0.35 + 0.65 * (0.5 + 0.5 * sin(t))
                post(
                    "ambilight/cached",
                    JSONObject()
                        .put("r", (r * k).toInt())
                        .put("g", (g * k).toInt())
                        .put("b", (b * k).toInt())
                )
                t += 0.45
                // ~8 fps. The TV accepts more, but each POST is a round trip through
                // a Restlet stack that is not built for a frame loop.
                delay(125)
            }
        }
    }

    fun stopPulse(restore: Boolean = true) {
        pulseJob?.cancel()
        pulseJob = null
        if (!restore) return
        scope.launch(Dispatchers.IO) {
            savedConfig?.let { post("ambilight/currentconfiguration", it) }
            post("ambilight/mode", JSONObject().put("current", savedMode ?: "internal"))
        }
    }

    private suspend fun get(path: String): JSONObject? = withContext(Dispatchers.IO) {
        runCatching {
            http.newCall(Request.Builder().url("$BASE/$path").build()).execute().use { res ->
                res.body?.string()?.let { JSONObject(it) }
            }
        }.onFailure { Log.w(TAG, "GET $path failed: $it") }.getOrNull()
    }

    private fun post(path: String, body: JSONObject) {
        runCatching {
            http.newCall(
                Request.Builder()
                    .url("$BASE/$path")
                    .post(body.toString().toRequestBody(JSON))
                    .build()
            ).execute().close()
        }.onFailure { Log.w(TAG, "POST $path failed: $it") }
    }

    companion object {
        private const val TAG = "Ambilight"
        private const val BASE = "http://127.0.0.1:1925/6"
        private val JSON = "application/json".toMediaType()
    }
}
