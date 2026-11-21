package it.davideghiotto.memoriestv.ui

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.tv.material3.Text
import coil3.SingletonImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import it.davideghiotto.memoriestv.data.ImageSize
import it.davideghiotto.memoriestv.data.Memory
import kotlinx.coroutines.delay

private const val MEMORY_SLIDE_MS = 4500L

/**
 * A memory, like the iOS player: full screen, auto-advancing Ken Burns, segment bars along the
 * top and the title over the first slides. Left/right skip, OK pauses, back leaves. Videos show
 * their poster frame (a memory is a slideshow).
 */
@Composable
fun MemoryPlayerDialog(memory: Memory, onClose: () -> Unit) {
    val context = LocalContext.current
    val assets = memory.assets
    var index by remember { mutableIntStateOf(0) }
    var paused by remember { mutableStateOf(false) }
    var progress by remember { mutableFloatStateOf(0f) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(index) {
        val loader = SingletonImageLoader.get(context)
        assets.getOrNull(index + 1)?.let { loader.enqueue(ImageRequest.Builder(context).data(service.image(it.id, ImageSize.Preview, it.thumbhash)).build()) }
    }
    LaunchedEffect(index, paused) {
        if (paused) return@LaunchedEffect
        val start = System.nanoTime() - (progress * MEMORY_SLIDE_MS * 1_000_000).toLong()
        while (true) {
            progress = ((System.nanoTime() - start) / 1e6f / MEMORY_SLIDE_MS).coerceAtMost(1f)
            if (progress >= 1f) break
            delay(16)
        }
        progress = 0f
        if (index < assets.size - 1) index++ else onClose()
    }

    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(
            Modifier.fillMaxSize().background(Color.Black)
                .onPreviewKeyEvent { e ->
                    if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    when (e.key) {
                        Key.DirectionRight -> { progress = 0f; if (index < assets.size - 1) index++ else onClose(); true }
                        Key.DirectionLeft -> { progress = 0f; if (index > 0) index--; true }
                        Key.DirectionCenter, Key.Enter, Key.MediaPlayPause -> { paused = !paused; true }
                        else -> false
                    }
                }
                .focusRequester(focus)
                .focusable(),
        ) {
            Crossfade(index, animationSpec = tween(900), label = "memory") { i ->
                val a = assets[i]
                val t = if (i == index) progress else 1f
                val zoom = 1.04f + 0.1f * t
                Box(Modifier.fillMaxSize().graphicsLayer {
                    scaleX = zoom; scaleY = zoom
                    translationX = (if (i % 2 == 0) -1 else 1) * 24f * t
                }) {
                    AsyncImage(service.image(a.id, ImageSize.Preview, a.thumbhash), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                }
            }
            Box(Modifier.fillMaxWidth().height(160.dp).topScrim())
            // Segment bars, one per slide.
            Row(Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 22.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                assets.indices.forEach { i ->
                    Box(Modifier.weight(1f).height(3.dp).clip(CircleShape).background(C.label.copy(alpha = 0.3f))) {
                        val f = when { i < index -> 1f; i == index -> progress; else -> 0f }
                        Box(Modifier.fillMaxWidth(f).height(3.dp).background(C.label))
                    }
                }
            }
            Column(Modifier.align(Alignment.TopStart).padding(start = 48.dp, top = 44.dp)) {
                Text(memory.title, fontSize = 30.sp, fontWeight = FontWeight.Bold, color = C.label)
                Text("${memory.year}", style = Type.headline.copy(color = C.label.copy(alpha = 0.85f)))
            }
            if (paused) {
                Box(Modifier.align(Alignment.Center).glass().padding(horizontal = 22.dp, vertical = 10.dp)) {
                    Text("Paused", style = Type.headline)
                }
            }
        }
        LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    }
}
