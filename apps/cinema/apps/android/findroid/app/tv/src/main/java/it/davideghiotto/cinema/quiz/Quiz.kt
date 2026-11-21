package it.davideghiotto.cinema.quiz

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.Player
import dev.jdtech.jellyfin.BuildConfig
import dev.jdtech.jellyfin.api.JellyfinApi
import java.text.Normalizer
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import timber.log.Timber

/**
 * Film quizzes on the TV, the same files and rules as the web player (apps/web/src/features/quiz):
 * `/quizzes/<tmdb-id>.json` on Cinema's origin, questions pinned to seconds into the film. When the
 * quiz is on, the film stops at each question it plays across.
 */
sealed interface QuizQuestion {
    val at: Double
    val question: String
    val explain: String?

    data class Choice(
        override val at: Double,
        override val question: String,
        val options: List<String>,
        val answer: Int,
        override val explain: String?,
    ) : QuizQuestion

    data class TrueFalse(
        override val at: Double,
        override val question: String,
        val answer: Boolean,
        override val explain: String?,
    ) : QuizQuestion

    data class Text(
        override val at: Double,
        override val question: String,
        val accept: List<String>,
        override val explain: String?,
    ) : QuizQuestion
}

val QuizQuestion.rightAnswer: String
    get() =
        when (this) {
            is QuizQuestion.Choice -> options.getOrElse(answer) { "" }
            is QuizQuestion.TrueFalse -> if (answer) "Vero" else "Falso"
            is QuizQuestion.Text -> accept.firstOrNull() ?: ""
        }

/** The labels shown on screen for a question with fixed answers, empty for a free answer. */
val QuizQuestion.optionLabels: List<String>
    get() =
        when (this) {
            is QuizQuestion.Choice -> options
            is QuizQuestion.TrueFalse -> listOf("Vero", "Falso")
            is QuizQuestion.Text -> emptyList()
        }

/** The question as JARVIS wants it in `ask`, answer included (JARVIS keeps it until reveal). */
fun QuizQuestion.toJson(): JsonObject = buildJsonObject {
    put("at", at)
    put("question", question)
    explain?.let { put("explain", it) }
    when (val q = this@toJson) {
        is QuizQuestion.Choice -> {
            put("type", "choice")
            put("options", buildJsonArray { q.options.forEach { add(JsonPrimitive(it)) } })
            put("answer", q.answer)
        }
        is QuizQuestion.TrueFalse -> {
            put("type", "truefalse")
            put("answer", q.answer)
        }
        is QuizQuestion.Text -> {
            put("type", "text")
            put("accept", buildJsonArray { q.accept.forEach { add(JsonPrimitive(it)) } })
        }
    }
}

private fun normalise(s: String) =
    Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
        .replace(Regex("\\p{Mn}+"), "")
        .replace(Regex("[^a-z0-9 ]"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()

internal val quizJson = Json { ignoreUnknownKeys = true }

internal val quizHttp: OkHttpClient =
    OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

private fun parseQuestions(raw: String): List<QuizQuestion> {
    val root = quizJson.parseToJsonElement(raw).jsonObject
    return root["questions"]!!
        .jsonArray
        .mapNotNull { element ->
            val q = element.jsonObject
            val at = q["at"]!!.jsonPrimitive.double
            val text = q["question"]!!.jsonPrimitive.content
            val explain = q["explain"]?.jsonPrimitive?.contentOrNull
            when (q["type"]?.jsonPrimitive?.contentOrNull) {
                "choice" ->
                    QuizQuestion.Choice(
                        at,
                        text,
                        q["options"]!!.jsonArray.map { it.jsonPrimitive.content },
                        q["answer"]!!.jsonPrimitive.int,
                        explain,
                    )
                "truefalse" ->
                    QuizQuestion.TrueFalse(at, text, q["answer"]!!.jsonPrimitive.boolean, explain)
                "text" ->
                    QuizQuestion.Text(
                        at,
                        text,
                        (q["accept"] as? JsonArray)?.map { it.jsonPrimitive.content }
                            ?: emptyList(),
                        explain,
                    )
                else -> null
            }
        }
        .sortedBy { it.at }
}

/**
 * The quiz state for one film in the player: loaded questions, the on/off switch (remembered across
 * films: a quiz night is a quiz night), which questions are answered, and the one on screen.
 */
class QuizController(context: Context) {
    private val prefs = context.getSharedPreferences("cinema.quiz", Context.MODE_PRIVATE)

    /** The film's quiz file name ("tmdb-672"), null until known or when it has no ids. */
    var key by mutableStateOf<String?>(null)
        private set

    var questions by mutableStateOf<List<QuizQuestion>>(emptyList())
        private set

    var enabled by mutableStateOf(prefs.getBoolean("enabled", false))
        private set

    /** Index of the question on screen, or null while the film plays. */
    var asking by mutableStateOf<Int?>(null)
        private set

    /** Question index -> answered right. */
    val answers = mutableStateMapOf<Int, Boolean>()

    /** Quiz night with phones through JARVIS, when this build carries the host key. */
    val partyKey: String? = BuildConfig.QUIZ_HOST_KEY.takeIf { it.isNotBlank() }

    private var lastMs = -1L

    fun switchTo(on: Boolean) {
        enabled = on
        prefs.edit().putBoolean("enabled", on).apply()
    }

    suspend fun load(context: Context, itemId: UUID) {
        withContext(Dispatchers.IO) {
            runCatching {
                val api = JellyfinApi.getInstance(context)
                val item =
                    api.userLibraryApi.getItem(itemId = itemId, userId = api.userId!!).content
                val ids = item.providerIds.orEmpty()
                val name =
                    ids["Tmdb"]?.let { "tmdb-$it" }
                        ?: ids["Imdb"]?.let { "imdb-$it" }
                        ?: "item-$itemId"
                key = name
                val request =
                    Request.Builder()
                        .url("${BuildConfig.QUIZ_BASE_URL}/quizzes/$name.json")
                        .header("Cache-Control", "no-cache")
                        .build()
                quizHttp.newCall(request).execute().use { response ->
                    val type = response.header("Content-Type").orEmpty()
                    // nginx answers an unknown path with index.html: not JSON means no quiz.
                    if (response.isSuccessful && type.contains("json")) {
                        questions = parseQuestions(response.body.string())
                    }
                }
                Timber.tag("Quiz").i("%s: %d questions", name, questions.size)
            }
                .onFailure { Timber.tag("Quiz").w(it, "quiz not loaded") }
        }
    }

    /**
     * Called a few times a second with the playhead. Stops the film when playback runs across an
     * unanswered question; a jump (a seek) never counts, so skipping ahead asks nothing.
     */
    fun tick(player: Player, seeking: Boolean) {
        val now = player.currentPosition
        val before = lastMs
        lastMs = now
        if (!enabled || asking != null || seeking || !player.isPlaying) return
        if (before < 0 || now <= before || now - before > 2_000) return
        val index =
            questions.indices.firstOrNull { i ->
                i !in answers && questions[i].at * 1000 > before && questions[i].at * 1000 <= now
            } ?: return
        player.pause()
        asking = index
        Timber.tag("Quiz").i("question %d at %d ms", index + 1, now)
    }

    fun answered(index: Int, right: Boolean) {
        answers[index] = right
    }

    /** Back to the film. */
    fun close(player: Player) {
        asking = null
        lastMs = player.currentPosition
        player.play()
    }

    fun restart() = answers.clear()

    companion object {
        /** A free answer counts with one typo forgiven per six letters, as on the web. */
        fun freeAnswerIsRight(given: String, accept: List<String>): Boolean {
            val g = normalise(given)
            if (g.isEmpty()) return false
            return accept.any { a ->
                val n = normalise(a)
                distance(g, n) <= n.length / 6
            }
        }

        private fun distance(a: String, b: String): Int {
            var prev = IntArray(b.length + 1) { it }
            for (i in 1..a.length) {
                val row = IntArray(b.length + 1)
                row[0] = i
                for (j in 1..b.length) {
                    row[j] =
                        minOf(
                            prev[j] + 1,
                            row[j - 1] + 1,
                            prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1,
                        )
                }
                prev = row
            }
            return prev[b.length]
        }

        internal fun bool(o: JsonObject, name: String) = o[name]?.jsonPrimitive?.booleanOrNull
    }
}
