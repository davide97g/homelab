package it.davideghiotto.cinema.player

import android.os.SystemClock
import android.view.KeyEvent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.tv.material3.Button
import androidx.tv.material3.ButtonDefaults
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Text
import dev.jdtech.jellyfin.ui.components.player.VideoPlayerState
import it.davideghiotto.cinema.design.CinemaColors
import kotlin.math.abs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import timber.log.Timber

/**
 * Relative seeking for the TV player: ±10 s, ±30 s, ±1 min, from the remote or the control bar.
 *
 * Presses add up into a pending target that is shown on screen and committed once the remote has
 * been quiet for [COMMIT_DELAY_MS]. One seek instead of one per press matters here: a transcoded
 * stream restarts ffmpeg on the server at every seek.
 *
 * Holding a key, or tapping it quickly, accelerates: the step grows from the key's base step to 30
 * s and then 1 min.
 */
class SeekController(private val player: Player, private val scope: CoroutineScope) {
    /** Where playback will land, while presses are still being added up; null when idle. */
    var pendingTargetMs by mutableStateOf<Long?>(null)
        private set

    /** The sum of the pending presses, signed. */
    var pendingDeltaMs by mutableLongStateOf(0L)
        private set

    private var commitJob: Job? = null
    private var lastPressAt = 0L
    private var lastDirection = 0
    private var streak = 0

    /** A fixed step, from a control-bar button. */
    fun seekBy(deltaMs: Long) {
        streak = 0
        lastDirection = 0
        add(deltaMs)
    }

    /**
     * A remote key: [direction] is +1 or -1, [baseMs] the first step. Returns false for a
     * key-repeat arriving too soon, which is dropped so a held key does not race through the film.
     * With [accelerate] false every press is exactly [baseMs] (the timeline: 10 s, never more).
     */
    fun press(
        direction: Int,
        baseMs: Long,
        isRepeat: Boolean,
        accelerate: Boolean = true,
    ): Boolean {
        val now = SystemClock.uptimeMillis()
        if (isRepeat && now - lastPressAt < REPEAT_THROTTLE_MS) return false
        streak =
            if (direction == lastDirection && now - lastPressAt < STREAK_WINDOW_MS) streak + 1
            else 0
        lastDirection = direction
        lastPressAt = now
        val step =
            when {
                !accelerate || streak < 4 -> baseMs
                streak < 10 -> maxOf(baseMs, 30_000L)
                else -> 60_000L
            }
        add(direction * step)
        return true
    }

    private fun add(deltaMs: Long) {
        val duration = player.duration.takeIf { it != C.TIME_UNSET && it > 0 }
        val from = pendingTargetMs ?: player.currentPosition
        val target = (from + deltaMs).coerceIn(0L, duration?.minus(1_000L) ?: Long.MAX_VALUE)
        if (pendingTargetMs == null) pendingDeltaMs = 0L
        pendingDeltaMs += target - from
        pendingTargetMs = target

        commitJob?.cancel()
        commitJob = scope.launch {
            delay(COMMIT_DELAY_MS)
            Timber.tag("Seek").d("seek %+d ms to %d ms", pendingDeltaMs, target)
            player.seekTo(target)
            // Keep the label up until the player reports the new position.
            delay(400)
            pendingTargetMs = null
            pendingDeltaMs = 0L
        }
    }

    companion object {
        const val COMMIT_DELAY_MS = 700L
        private const val STREAK_WINDOW_MS = 1_000L
        private const val REPEAT_THROTTLE_MS = 120L
    }
}

@Composable
fun rememberSeekController(player: Player): SeekController {
    val scope = rememberCoroutineScope()
    return remember(player) { SeekController(player, scope) }
}

/**
 * Remote keys for seeking on the player's root.
 * - ←/→ with the controls hidden: ±10 s, accelerating.
 * - ⏪/⏩ (media rewind / fast forward), always: ±30 s, accelerating.
 * - media skip back / forward, always: ±1 min.
 *
 * With the controls up, ←/→ belong to focus navigation and the seek bar.
 */
fun Modifier.seekKeys(
    seek: SeekController,
    blocked: () -> Boolean = { false },
    controlsVisible: () -> Boolean,
): Modifier = onPreviewKeyEvent { event ->
    val native = event.nativeKeyEvent
    val (direction, base) =
        when (native.keyCode) {
            KeyEvent.KEYCODE_DPAD_LEFT -> -1 to 10_000L
            KeyEvent.KEYCODE_DPAD_RIGHT -> 1 to 10_000L
            KeyEvent.KEYCODE_MEDIA_REWIND -> -1 to 30_000L
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> 1 to 30_000L
            KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD -> -1 to 60_000L
            KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD -> 1 to 60_000L
            else -> return@onPreviewKeyEvent false
        }
    val isDpad =
        native.keyCode == KeyEvent.KEYCODE_DPAD_LEFT ||
            native.keyCode == KeyEvent.KEYCODE_DPAD_RIGHT
    // A quiz card is up: every key is its own.
    if (blocked()) return@onPreviewKeyEvent false
    if (isDpad && controlsVisible()) return@onPreviewKeyEvent false
    // Act on down (and its repeats), swallow the up so nothing else acts on it.
    if (native.action == KeyEvent.ACTION_DOWN) {
        seek.press(direction, base, isRepeat = native.repeatCount > 0)
    }
    true
}

/** The pending seek, top centre: "+1:30" and where it lands. */
@Composable
fun SeekIndicator(seek: SeekController, durationMs: Long, modifier: Modifier = Modifier) {
    val target = seek.pendingTargetMs
    Box(
        modifier = modifier.fillMaxSize().padding(top = 48.dp),
        contentAlignment = Alignment.TopCenter,
    ) {
        AnimatedVisibility(visible = target != null, enter = fadeIn(), exit = fadeOut()) {
            Column(
                modifier =
                    Modifier.background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(16.dp))
                        .padding(horizontal = 28.dp, vertical = 14.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                val delta = seek.pendingDeltaMs
                Text(
                    text = (if (delta < 0) "−" else "+") + formatTime(abs(delta)),
                    color = CinemaColors.primary,
                    fontSize = 34.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text =
                        formatTime(target ?: 0L) +
                            if (durationMs > 0) " / ${formatTime(durationMs)}" else "",
                    color = CinemaColors.foreground,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

/** −1m −30 −10 +10 +30 +1m, for the control bar. */
@Composable
fun SeekButtons(seek: SeekController, state: VideoPlayerState, isPlaying: Boolean) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((label, delta) in STEPS) {
            SeekButton(label, state, isPlaying) { seek.seekBy(delta) }
        }
    }
}

private val STEPS =
    listOf(
        "−1m" to -60_000L,
        "−30" to -30_000L,
        "−10" to -10_000L,
        "+10" to 10_000L,
        "+30" to 30_000L,
        "+1m" to 60_000L,
    )

@Composable
private fun SeekButton(
    label: String,
    state: VideoPlayerState,
    isPlaying: Boolean,
    onClick: () -> Unit,
) {
    val interactionSource = remember { MutableInteractionSource() }
    val isFocused by interactionSource.collectIsFocusedAsState()
    // Same as the media buttons: a focused control keeps the bar up while playing.
    LaunchedEffect(isFocused && isPlaying) { if (isFocused && isPlaying) state.showControls() }
    Button(
        onClick = {
            onClick()
            if (isPlaying) state.showControls()
        },
        interactionSource = interactionSource,
        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
        colors =
            ButtonDefaults.colors(
                containerColor = Color.White.copy(alpha = 0.1f),
                contentColor = CinemaColors.foreground,
                focusedContainerColor = CinemaColors.primary,
                focusedContentColor = CinemaColors.onPrimary,
            ),
    ) {
        Text(text = label, fontWeight = FontWeight.SemiBold)
    }
}

private fun formatTime(ms: Long): String {
    val total = ms / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}
