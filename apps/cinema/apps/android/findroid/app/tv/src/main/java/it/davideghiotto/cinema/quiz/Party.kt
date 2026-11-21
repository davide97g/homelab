package it.davideghiotto.cinema.quiz

import dev.jdtech.jellyfin.BuildConfig
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import timber.log.Timber

/**
 * Quiz night through JARVIS (jarvis.davideghiotto.it/quiz), the TV as host: when the film reaches a
 * question it asks it on every phone, and shows who answered and who is winning. The same protocol
 * as the web host (apps/web/src/features/quiz/party.ts).
 */
data class PartyPlayer(
    val id: String,
    val name: String,
    val joined: Boolean,
    val score: Int,
    val right: Int,
)

data class PartyResult(val answer: String, val right: Boolean, val points: Int)

data class PartyCurrent(
    val id: String,
    val revealed: Boolean,
    val openedAt: Long,
    /** The options come 5 s after the question (JARVIS withholds them until then). */
    val optionsOpen: Boolean,
    val optionsAt: Long,
    val revealAt: Long,
    val answered: Set<String>,
    val right: String?,
    val rightIndex: Int?,
    val explain: String?,
    val results: Map<String, PartyResult>,
)

/** [skewMs]: JARVIS's clock minus this TV's, so countdowns follow the server. */
data class PartyState(
    val current: PartyCurrent?,
    val standings: List<PartyPlayer>,
    val skewMs: Long = 0L,
)

object Party {
    private val jarvis = BuildConfig.JARVIS_URL

    /** JARVIS pings every 5 s: a stream silent for 12 s is dead, drop it and reconnect. */
    private val streamHttp = quizHttp.newBuilder().readTimeout(12, TimeUnit.SECONDS).build()

    fun cardUrl(key: String, id: String) =
        "$jarvis/quiz/card/$id?k=${URLEncoder.encode(key, "UTF-8")}"

    suspend fun host(key: String, action: String, body: JsonObject = JsonObject(emptyMap())) =
        withContext(Dispatchers.IO) {
            val request =
                Request.Builder()
                    .url("$jarvis/quiz/api/host/$action")
                    .header("X-Quiz-Key", key)
                    .post(body.toString().toRequestBody("application/json".toMediaType()))
                    .build()
            quizHttp.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("JARVIS ${response.code}")
                parse(response.body.string())
            }
        }

    suspend fun ask(key: String, id: String, number: Int, total: Int, question: QuizQuestion) =
        host(
            key,
            "ask",
            buildJsonObject {
                put("id", id)
                put("number", number)
                put("total", total)
                put("question", question.toJson())
            },
        )

    /** Live game state; reconnects every two seconds while the stream is down. */
    fun events(key: String, online: (Boolean) -> Unit): Flow<PartyState> = flow {
        while (true) {
            try {
                val request =
                    Request.Builder()
                        .url("$jarvis/quiz/api/events?k=${URLEncoder.encode(key, "UTF-8")}")
                        .header("Accept", "text/event-stream")
                        .build()
                streamHttp.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) error("JARVIS ${response.code}")
                    online(true)
                    val source = response.body.source()
                    var event = "message"
                    while (true) {
                        val line = source.readUtf8Line() ?: break
                        when {
                            line.isEmpty() -> event = "message"
                            line.startsWith("event:") -> event = line.removePrefix("event:").trim()
                            // "ping" events only keep the stream alive.
                            line.startsWith("data:") && event == "message" ->
                                emit(parse(line.removePrefix("data:")))
                        }
                    }
                }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                Timber.tag("Quiz").w("JARVIS stream: %s", e.message)
            }
            online(false)
            delay(500)
        }
    }
        .flowOn(Dispatchers.IO)

    private fun parse(raw: String): PartyState {
        val root = quizJson.parseToJsonElement(raw).jsonObject
        val standings =
            root["standings"]?.jsonArray.orEmpty().map {
                val p = it.jsonObject
                PartyPlayer(
                    id = p["id"]!!.jsonPrimitive.content,
                    name = p["name"]?.jsonPrimitive?.contentOrNull ?: "",
                    joined = p["joined"]?.jsonPrimitive?.booleanOrNull ?: false,
                    score = p["score"]?.jsonPrimitive?.intOrNull ?: 0,
                    right = p["right"]?.jsonPrimitive?.intOrNull ?: 0,
                )
            }
        val current =
            (root["current"] as? JsonObject)?.let { c ->
                PartyCurrent(
                    id = c["id"]!!.jsonPrimitive.content,
                    revealed = c["phase"]?.jsonPrimitive?.contentOrNull == "revealed",
                    openedAt = c["openedAt"]?.jsonPrimitive?.longOrNull ?: 0L,
                    optionsOpen = c["optionsOpen"]?.jsonPrimitive?.booleanOrNull ?: true,
                    optionsAt =
                        c["optionsAt"]?.jsonPrimitive?.longOrNull
                            ?: c["openedAt"]?.jsonPrimitive?.longOrNull
                            ?: 0L,
                    revealAt = c["revealAt"]?.jsonPrimitive?.longOrNull ?: 0L,
                    answered =
                        c["answered"]?.jsonArray.orEmpty().map { it.jsonPrimitive.content }.toSet(),
                    right = c["right"]?.jsonPrimitive?.contentOrNull,
                    rightIndex = c["rightIndex"]?.jsonPrimitive?.intOrNull,
                    explain = c["explain"]?.jsonPrimitive?.contentOrNull,
                    results =
                        (c["results"] as? JsonObject).orEmpty().mapValues { (_, v) ->
                            val r = v.jsonObject
                            PartyResult(
                                answer = r["answer"]?.jsonPrimitive?.contentOrNull ?: "",
                                right = r["right"]?.jsonPrimitive?.booleanOrNull ?: false,
                                points = r["points"]?.jsonPrimitive?.intOrNull ?: 0,
                            )
                        },
                )
            }
        val skew =
            root["now"]?.jsonPrimitive?.longOrNull?.let { it - System.currentTimeMillis() } ?: 0L
        return PartyState(current, standings, skew)
    }
}
