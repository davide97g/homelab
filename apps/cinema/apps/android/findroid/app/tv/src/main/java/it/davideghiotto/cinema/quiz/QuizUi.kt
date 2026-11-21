package it.davideghiotto.cinema.quiz

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import dev.jdtech.jellyfin.R
import dev.jdtech.jellyfin.ui.components.player.VideoPlayerState
import it.davideghiotto.cinema.design.CinemaColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val LETTERS = "ABCDEFGH"
private const val REVEAL_AFTER_MS = 30_000L
private const val OPTIONS_AFTER_MS = 5_000L

private fun timecode(seconds: Double): String {
    val t = seconds.toLong()
    val h = t / 3600
    val m = (t % 3600) / 60
    val s = t % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

@Composable
private fun cinemaButtonColors(primary: Boolean) =
    ButtonDefaults.colors(
        containerColor = if (primary) CinemaColors.primary else Color.White.copy(alpha = 0.1f),
        contentColor = if (primary) CinemaColors.onPrimary else CinemaColors.foreground,
        focusedContainerColor = if (primary) CinemaColors.foreground else CinemaColors.primary,
        focusedContentColor = if (primary) CinemaColors.canvas else CinemaColors.onPrimary,
    )

/** The quiz switch in the control bar: lit while the quiz is on. */
@Composable
fun QuizToggle(quiz: QuizController, state: VideoPlayerState, isPlaying: Boolean) {
    if (quiz.questions.isEmpty()) return
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()
    LaunchedEffect(isFocused && isPlaying) { if (isFocused && isPlaying) state.showControls() }
    val on = quiz.enabled
    Button(
        onClick = {
            quiz.switchTo(!on)
            if (isPlaying) state.showControls()
        },
        interactionSource = interactionSource,
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
        colors =
            ButtonDefaults.colors(
                containerColor =
                    if (on) CinemaColors.primary.copy(alpha = 0.35f)
                    else Color.White.copy(alpha = 0.1f),
                contentColor = if (on) CinemaColors.primary else CinemaColors.mutedForeground,
                focusedContainerColor = CinemaColors.primary,
                focusedContentColor = CinemaColors.onPrimary,
            ),
    ) {
        Icon(
            painter = painterResource(R.drawable.ic_quiz),
            contentDescription = if (on) "Quiz attivo" else "Quiz spento",
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(8.dp))
        val score =
            if (on && quiz.answers.isNotEmpty())
                " · ${quiz.answers.values.count { it }}/${quiz.answers.size}"
            else ""
        Text(
            text = (if (on) "Quiz ON" else "Quiz OFF") + score,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

/** The card on screen while a question is asked, solo or with the room's phones. */
@Composable
fun QuizOverlay(quiz: QuizController, onResume: () -> Unit) {
    val index = quiz.asking ?: return
    val question = quiz.questions.getOrNull(index) ?: return
    Box(
        modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.8f)).padding(48.dp),
        contentAlignment = Alignment.Center,
    ) {
        val party = quiz.partyKey
        if (party != null) {
            androidx.compose.runtime.key(index) {
                PartyCard(
                    partyKey = party,
                    questionId = "${quiz.key}:${formatAt(question.at)}",
                    question = question,
                    number = index + 1,
                    total = quiz.questions.size,
                    onRevealed = { quiz.answered(index, true) },
                    onClose = onResume,
                )
            }
        } else {
            androidx.compose.runtime.key(index) {
                SoloCard(
                    question = question,
                    number = index + 1,
                    total = quiz.questions.size,
                    onAnswer = { quiz.answered(index, it) },
                    onClose = onResume,
                )
            }
        }
    }
}

/** Matches the web's `${key}:${q.at}` (JS prints 436, not 436.0). */
private fun formatAt(at: Double): String =
    if (at == Math.floor(at)) at.toLong().toString() else at.toString()

@Composable
private fun Panel(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Column(
        modifier =
            modifier.background(CinemaColors.surface, RoundedCornerShape(16.dp)).padding(32.dp)
    ) {
        content()
    }
}

@Composable
private fun OptionRow(
    letter: Char,
    label: String,
    highlight: Boolean,
    dimmed: Boolean,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier =
            modifier
                .clip(RoundedCornerShape(10.dp))
                .background(
                    if (highlight) CinemaColors.match.copy(alpha = 0.18f)
                    else CinemaColors.surfaceRaised
                )
                .then(
                    if (highlight)
                        Modifier.border(2.dp, CinemaColors.match, RoundedCornerShape(10.dp))
                    else Modifier
                )
                .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(34.dp).background(Color.White.copy(alpha = 0.1f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                letter.toString(),
                fontWeight = FontWeight.SemiBold,
                color = CinemaColors.foreground,
            )
        }
        Spacer(Modifier.width(16.dp))
        Text(
            label,
            fontSize = 20.sp,
            color = if (dimmed) CinemaColors.mutedForeground else CinemaColors.foreground,
            modifier = Modifier.weight(1f),
        )
    }
}

// ---------------------------------------------------------------------------------------------
// Solo: answered with the remote.

@Composable
private fun SoloCard(
    question: QuizQuestion,
    number: Int,
    total: Int,
    onAnswer: (Boolean) -> Unit,
    onClose: () -> Unit,
) {
    // null: not answered yet; for a free answer the remote cannot type, so it is "show the answer".
    var picked by remember { mutableStateOf<Int?>(null) }
    var shown by remember { mutableStateOf(false) }
    val first = remember { FocusRequester() }
    val resume = remember { FocusRequester() }
    BackHandler(onBack = onClose)

    val right: Int? =
        when (question) {
            is QuizQuestion.Choice -> question.answer
            is QuizQuestion.TrueFalse -> if (question.answer) 0 else 1
            is QuizQuestion.Text -> null
        }
    val done = picked != null || shown
    // The question is read alone first; the options come after OPTIONS_AFTER_MS, as on the phones.
    var optionsShown by remember { mutableStateOf(false) }
    var optionsIn by remember { mutableStateOf(OPTIONS_AFTER_MS / 1000) }
    val skip = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        while (optionsIn > 0) {
            delay(1_000)
            optionsIn -= 1
        }
        optionsShown = true
    }
    LaunchedEffect(done, optionsShown) {
        runCatching {
            when {
                done -> resume.requestFocus()
                optionsShown -> first.requestFocus()
                else -> skip.requestFocus()
            }
        }
    }

    Panel(modifier = Modifier.widthIn(max = 900.dp)) {
        Text(
            "Domanda $number di $total · ${timecode(question.at)}",
            color = CinemaColors.mutedForeground,
        )
        Spacer(Modifier.height(10.dp))
        Text(
            question.question,
            fontSize = 32.sp,
            fontWeight = FontWeight.SemiBold,
            color = CinemaColors.foreground,
            lineHeight = 40.sp,
        )
        Spacer(Modifier.height(24.dp))
        val labels = question.optionLabels
        if (!optionsShown) {
            Text(
                "Le risposte tra ${optionsIn}s…",
                fontSize = 20.sp,
                color = CinemaColors.mutedForeground,
            )
        } else if (labels.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                labels.forEachIndexed { i, label ->
                    if (!done) {
                        Button(
                            onClick = {
                                picked = i
                                onAnswer(i == right)
                            },
                            modifier =
                                Modifier.fillMaxWidth()
                                    .then(if (i == 0) Modifier.focusRequester(first) else Modifier),
                            colors = cinemaButtonColors(primary = false),
                        ) {
                            Text("${LETTERS[i]}   $label", fontSize = 20.sp)
                        }
                    } else {
                        OptionRow(
                            letter = LETTERS[i],
                            label = label + if (i == picked && i != right) "  ✗" else "",
                            highlight = i == right,
                            dimmed = i != right,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            }
        } else if (!done) {
            Text(
                "Risposta libera: ditela ad alta voce, poi guardate.",
                fontSize = 20.sp,
                color = CinemaColors.mutedForeground,
            )
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(
                    onClick = { shown = true },
                    modifier = Modifier.focusRequester(first),
                    colors = cinemaButtonColors(primary = true),
                ) {
                    Text("Mostra la risposta")
                }
            }
        }

        if (done) {
            Spacer(Modifier.height(20.dp))
            val verdict =
                when {
                    shown -> "Risposta: ${question.rightAnswer}"
                    picked == right -> "Giusto!"
                    else -> "Sbagliato: era ${question.rightAnswer}"
                }
            Text(
                verdict,
                fontSize = 26.sp,
                fontWeight = FontWeight.SemiBold,
                color =
                    if (picked != null && picked != right) CinemaColors.danger
                    else CinemaColors.match,
            )
            question.explain?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, fontSize = 18.sp, color = CinemaColors.mutedForeground)
            }
            Spacer(Modifier.height(24.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (shown) {
                    Button(
                        onClick = {
                            onAnswer(true)
                            onClose()
                        },
                        modifier = Modifier.focusRequester(resume),
                        colors = cinemaButtonColors(primary = true),
                    ) {
                        Text("Lo sapevo · continua")
                    }
                    Button(
                        onClick = {
                            onAnswer(false)
                            onClose()
                        },
                        colors = cinemaButtonColors(primary = false),
                    ) {
                        Text("Non lo sapevo · continua")
                    }
                } else {
                    Button(
                        onClick = onClose,
                        modifier = Modifier.focusRequester(resume),
                        colors = cinemaButtonColors(primary = true),
                    ) {
                        Text("Continua il film")
                    }
                }
            }
        } else {
            Spacer(Modifier.height(20.dp))
            Button(
                onClick = onClose,
                modifier = Modifier.focusRequester(skip),
                colors = cinemaButtonColors(primary = false),
            ) {
                Text("Salta")
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Party: the room answers on their phones, the TV hosts.

@Composable
private fun PartyCard(
    partyKey: String,
    questionId: String,
    question: QuizQuestion,
    number: Int,
    total: Int,
    onRevealed: () -> Unit,
    onClose: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var state by remember { mutableStateOf<PartyState?>(null) }
    var online by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var wasLive by remember { mutableStateOf(false) }
    var revealedOnce by remember { mutableStateOf(false) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val action = remember { FocusRequester() }

    LaunchedEffect(Unit) {
        runCatching { Party.ask(partyKey, questionId, number, total, question) }
            .onSuccess { state = it }
            .onFailure { error = "JARVIS non risponde: i telefoni non vedono la domanda." }
    }
    LaunchedEffect(Unit) { Party.events(partyKey) { online = it }.collect { state = it } }

    val current = state?.current?.takeIf { it.id == questionId }
    val revealed = current?.revealed == true

    // "Continua il film" on the admin's phone closes the question on JARVIS: once this question
    // has been live, its disappearance means back to the film.
    LaunchedEffect(current != null, state) {
        if (current != null) wasLive = true else if (wasLive && state != null) onClose()
    }
    LaunchedEffect(revealed) {
        if (revealed && !revealedOnce) {
            revealedOnce = true
            onRevealed()
        }
    }
    LaunchedEffect(revealed) { runCatching { action.requestFocus() } }
    LaunchedEffect(revealed) {
        while (!revealed) {
            now = System.currentTimeMillis()
            delay(250)
        }
    }

    val close: () -> Unit = {
        scope.launch { runCatching { Party.host(partyKey, "close") } }
        onClose()
    }
    BackHandler(onBack = close)

    val standings = state?.standings.orEmpty()
    val room = standings.filter { it.joined }
    val answered = current?.answered.orEmpty()
    // JARVIS sends the options 5 s after the question; until then the bar stays full.
    val optionsOpen = revealed || current?.optionsOpen == true
    val serverNow = now + (state?.skewMs ?: 0L)
    val optionsIn = current?.let { ((it.optionsAt - serverNow + 999) / 1000).coerceAtLeast(0) } ?: 5
    val left =
        if (current == null || !optionsOpen) 1f
        else ((current.revealAt - serverNow).toFloat() / REVEAL_AFTER_MS).coerceIn(0f, 1f)
    val lead = standings.firstOrNull()?.score ?: 0

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(24.dp),
    ) {
        Panel(modifier = Modifier.weight(1f)) {
            Text(
                "Domanda $number di $total · ${timecode(question.at)}" +
                    if (!online) " · riconnessione a JARVIS…" else "",
                color = CinemaColors.mutedForeground,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                question.question,
                fontSize = 30.sp,
                fontWeight = FontWeight.SemiBold,
                color = CinemaColors.foreground,
                lineHeight = 38.sp,
            )
            if (!revealed) {
                Spacer(Modifier.height(16.dp))
                Box(
                    Modifier.fillMaxWidth()
                        .height(4.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(Color.White.copy(alpha = 0.1f))
                ) {
                    Box(
                        Modifier.fillMaxHeight().fillMaxWidth(left).background(CinemaColors.primary)
                    )
                }
                Spacer(Modifier.height(6.dp))
                Text(
                    when {
                        !optionsOpen ->
                            if (optionsIn > 0) "Le risposte tra ${optionsIn}s…"
                            else "Ecco le risposte…"
                        left > 0f -> "La risposta tra ${Math.ceil(left * 30.0).toInt()}s"
                        else -> "Ecco la risposta…"
                    },
                    color = CinemaColors.mutedForeground,
                )
            }
            val labels = question.optionLabels
            if (labels.isNotEmpty() && optionsOpen) {
                Spacer(Modifier.height(16.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    labels.chunked(2).forEachIndexed { row, pair ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            pair.forEachIndexed { col, label ->
                                val i = row * 2 + col
                                val isRight = revealed && i == current?.rightIndex
                                OptionRow(
                                    letter = LETTERS[i],
                                    label = label,
                                    highlight = isRight,
                                    dimmed = revealed && !isRight,
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            if (pair.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }
            if (revealed) {
                Spacer(Modifier.height(16.dp))
                Text(
                    "Risposta: ${current?.right ?: question.rightAnswer}",
                    fontSize = 24.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = CinemaColors.match,
                )
                current?.explain?.let {
                    Spacer(Modifier.height(6.dp))
                    Text(it, fontSize = 18.sp, color = CinemaColors.mutedForeground)
                }
            } else if (question is QuizQuestion.Text && optionsOpen) {
                Spacer(Modifier.height(16.dp))
                Text(
                    "Risposta libera: scrivetela sul telefono.",
                    fontSize = 20.sp,
                    color = CinemaColors.mutedForeground,
                )
            }

            Spacer(Modifier.height(20.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                room.forEach { p ->
                    PlayerChip(
                        partyKey,
                        p,
                        answered = p.id in answered,
                        revealed = revealed,
                        result = current?.results?.get(p.id),
                    )
                }
                if (room.isEmpty()) {
                    Text(
                        "Nessuno è ancora entrato con il suo link.",
                        color = CinemaColors.mutedForeground,
                    )
                }
            }
            error?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, color = CinemaColors.danger)
            }
            Spacer(Modifier.height(20.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (!revealed) {
                    Text(
                        "${answered.size} di ${room.size} hanno risposto",
                        color = CinemaColors.mutedForeground,
                    )
                }
                Spacer(Modifier.weight(1f))
                Button(onClick = close, colors = cinemaButtonColors(primary = false)) {
                    Text(if (revealed) "Chiudi" else "Salta")
                }
                Spacer(Modifier.width(12.dp))
                Button(
                    onClick = {
                        if (revealed) close()
                        else
                            scope.launch {
                                runCatching { Party.host(partyKey, "reveal") }
                                    .onSuccess { state = it }
                                    .onFailure { error = "Rivelazione non riuscita." }
                            }
                    },
                    modifier = Modifier.focusRequester(action),
                    colors = cinemaButtonColors(primary = true),
                ) {
                    Text(if (revealed) "Continua il film" else "Rivela")
                }
            }
        }

        Panel(modifier = Modifier.width(300.dp)) {
            Text(
                "CLASSIFICA",
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = CinemaColors.mutedForeground,
            )
            Spacer(Modifier.height(12.dp))
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                standings.forEachIndexed { i, p ->
                    Row(
                        modifier =
                            Modifier.fillMaxWidth()
                                .alpha(if (p.joined) 1f else 0.4f)
                                .background(CinemaColors.surfaceRaised, RoundedCornerShape(8.dp))
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "${i + 1}",
                            color = CinemaColors.mutedForeground,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.width(20.dp),
                        )
                        AsyncImage(
                            model = Party.cardUrl(partyKey, p.id),
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier =
                                Modifier.size(width = 30.dp, height = 40.dp)
                                    .clip(RoundedCornerShape(4.dp)),
                        )
                        Spacer(Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                p.name + if (i == 0 && lead > 0) " ♛" else "",
                                fontWeight = FontWeight.SemiBold,
                                color = CinemaColors.foreground,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                "${p.right} giuste",
                                fontSize = 12.sp,
                                color = CinemaColors.mutedForeground,
                            )
                        }
                        Text(
                            "${p.score}",
                            fontSize = 20.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = CinemaColors.foreground,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PlayerChip(
    partyKey: String,
    player: PartyPlayer,
    answered: Boolean,
    revealed: Boolean,
    result: PartyResult?,
) {
    val ring =
        when {
            revealed && result?.right == true -> CinemaColors.match
            revealed && result != null -> CinemaColors.danger
            answered && !revealed -> CinemaColors.primary
            else -> Color.Transparent
        }
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(96.dp)) {
        AsyncImage(
            model = Party.cardUrl(partyKey, player.id),
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier =
                Modifier.size(width = 84.dp, height = 116.dp)
                    .alpha(if (answered || revealed) 1f else 0.35f)
                    .clip(RoundedCornerShape(8.dp))
                    .border(2.dp, ring, RoundedCornerShape(8.dp)),
        )
        Spacer(Modifier.height(6.dp))
        Text(player.name, fontWeight = FontWeight.SemiBold, color = CinemaColors.foreground)
        if (revealed) {
            Text(
                when {
                    result == null -> "—"
                    result.right -> "+${result.points}"
                    else -> result.answer
                },
                fontSize = 13.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                color =
                    if (result?.right == true) CinemaColors.match else CinemaColors.mutedForeground,
            )
        }
    }
}
