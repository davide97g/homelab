package it.davideghiotto.memoriestv.ui

import android.view.ViewGroup
import androidx.annotation.OptIn
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil3.SingletonImageLoader
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import it.davideghiotto.memoriestv.MemoriesApp
import it.davideghiotto.memoriestv.data.Asset
import it.davideghiotto.memoriestv.data.AssetDetail
import it.davideghiotto.memoriestv.data.Dates
import it.davideghiotto.memoriestv.data.ImageSize
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val SLIDE_MS = 5000L

/**
 * The full-screen viewer. Left/right page, OK shows the controls, up opens Info, back steps out
 * (Info, then controls, then the viewer). Videos play on arrival; a live photo plays its motion
 * from the controls. Slideshow: crossfade and a slow Ken Burns push, five seconds a photo.
 */
@OptIn(UnstableApi::class)
@Composable
fun ViewerDialog(overlay: Overlay.Viewer, onClose: (Int) -> Unit) {
    val source = overlay.source
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var index by remember { mutableIntStateOf(overlay.index.coerceIn(0, (source.count - 1).coerceAtLeast(0))) }
    var direction by remember { mutableIntStateOf(1) }
    var chrome by remember { mutableStateOf(false) }
    var info by remember { mutableStateOf(false) }
    var slideshow by remember { mutableStateOf(overlay.slideshow) }
    var livePlaying by remember { mutableStateOf(false) }
    var videoPlaying by remember { mutableStateOf(false) }
    var lastInput by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val details = remember { mutableStateMapOf<String, AssetDetail>() }
    val rootFocus = remember { FocusRequester() }
    val barFocus = remember { FocusRequester() }

    val asset = source.asset(index)
    LaunchedEffect(index) {
        source.ensure(index)
        source.ensure((index + 1).coerceAtMost(source.count - 1))
        livePlaying = false
    }

    // Warm the neighbours' previews so paging is instant.
    LaunchedEffect(index, asset != null) {
        val loader = SingletonImageLoader.get(context)
        for (d in listOf(1, -1, 2)) {
            val a = source.asset(index + d) ?: continue
            if (a.isImage) loader.enqueue(ImageRequest.Builder(context).data(service.image(a.id, ImageSize.Preview, a.thumbhash)).build())
        }
    }

    // One player for the whole viewer: videos and live-photo motion.
    val player = remember {
        ExoPlayer.Builder(context)
            .setMediaSourceFactory(DefaultMediaSourceFactory(OkHttpDataSource.Factory(MemoriesApp.instance.http)))
            .build()
    }
    DisposableEffect(Unit) { onDispose { player.release() } }
    DisposableEffect(player) {
        val l = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) { videoPlaying = isPlaying }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED) {
                    if (livePlaying) livePlaying = false
                    else if (slideshow && index < source.count - 1) { direction = 1; index++ }
                }
            }
        }
        player.addListener(l)
        onDispose { player.removeListener(l) }
    }

    val playbackId = when {
        asset == null -> null
        asset.isVideo -> asset.id
        livePlaying -> asset.livePhotoVideoId
        else -> null
    }
    LaunchedEffect(playbackId) {
        if (playbackId == null) { player.stop(); player.clearMediaItems(); return@LaunchedEffect }
        val src = service.video(playbackId) ?: return@LaunchedEffect
        player.setMediaItem(MediaItem.fromUri(src.url))
        player.prepare()
        player.playWhenReady = true
    }

    // Slideshow: advance photos on a timer (videos advance when they end).
    LaunchedEffect(slideshow, index, asset?.isVideo) {
        if (!slideshow || asset == null || asset.isVideo) return@LaunchedEffect
        delay(SLIDE_MS)
        if (index < source.count - 1) { direction = 1; index++ } else slideshow = false
    }

    // Controls fade away after a few idle seconds.
    LaunchedEffect(chrome, lastInput, info) {
        if (chrome && !info) {
            delay(5000)
            chrome = false
        }
    }
    LaunchedEffect(chrome) { runCatching { if (chrome) barFocus.requestFocus() else rootFocus.requestFocus() } }

    fun go(delta: Int) {
        val next = index + delta
        if (next in 0 until source.count) { direction = delta; index = next }
    }

    fun close() { player.stop(); onClose(index) }

    fun toggleFavorite() {
        val a = source.asset(index) ?: return
        source.updateFavorite(a.id, !a.isFavorite)
        scope.launch {
            runCatching { service.setFavorite(listOf(a.id), !a.isFavorite) }
                .onFailure { source.updateFavorite(a.id, a.isFavorite) }
        }
    }

    Dialog(
        onDismissRequest = {
            when {
                info -> info = false
                chrome -> chrome = false
                slideshow -> slideshow = false
                else -> close()
            }
        },
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black)
                .onPreviewKeyEvent { e ->
                    if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                    lastInput = System.currentTimeMillis()
                    when {
                        e.key == Key.MediaFastForward && asset?.isVideo == true -> { player.seekTo(player.currentPosition + 10_000); true }
                        e.key == Key.MediaRewind && asset?.isVideo == true -> { player.seekTo((player.currentPosition - 10_000).coerceAtLeast(0)); true }
                        e.key == Key.MediaPlayPause || e.key == Key.MediaPlay || e.key == Key.MediaPause -> {
                            if (asset?.isVideo == true) { if (player.isPlaying) player.pause() else player.play() } else slideshow = !slideshow
                            true
                        }
                        chrome || info -> false
                        e.key == Key.DirectionLeft -> { slideshow = false; go(-1); true }
                        e.key == Key.DirectionRight -> { slideshow = false; go(1); true }
                        e.key == Key.DirectionUp -> { info = true; true }
                        e.key == Key.DirectionDown || e.key == Key.DirectionCenter || e.key == Key.Enter -> {
                            if (slideshow) slideshow = false else chrome = true
                            true
                        }
                        else -> false
                    }
                }
                .focusRequester(rootFocus)
                .focusable(),
        ) {
            // Pages.
            Crossfade(targetState = index, animationSpec = tween(if (slideshow) 900 else 220), label = "page") { i ->
                val a = source.asset(i)
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    if (a == null) Loading()
                    else if (a.isVideo || (livePlaying && i == index)) {
                        PhotoPage(a, kenBurns = false)
                        if (i == index) VideoSurface(player, a.ratio)
                    } else {
                        PhotoPage(a, kenBurns = slideshow)
                    }
                }
            }

            if (asset?.isLivePhoto == true && !chrome) {
                LiveGlyph(Modifier.align(Alignment.TopStart).padding(28.dp).size(22.dp))
            }

            // Controls: date on top, filmstrip and glass buttons below.
            AnimatedVisibility(chrome, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize()) {
                    if (asset != null) {
                        Box(Modifier.fillMaxWidth().height(120.dp).topScrim())
                        Column(Modifier.align(Alignment.TopCenter).padding(top = 22.dp).glass().padding(horizontal = 20.dp, vertical = 8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(Dates.dayMonthYear(asset.local), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = C.label)
                            Text(listOfNotNull(Dates.time(asset.local), asset.place).joinToString(" · "), style = Type.caption)
                        }
                    }
                    Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().bottomScrim().padding(bottom = 22.dp)) {
                        Filmstrip(source, index, onPick = { i -> direction = if (i > index) 1 else -1; index = i })
                        Spacer(Modifier.height(14.dp))
                        Row(
                            Modifier.align(Alignment.CenterHorizontally),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (asset?.isVideo == true) {
                                GlassButton(onClick = { if (player.isPlaying) player.pause() else player.play() },
                                    modifier = Modifier.focusRequester(barFocus),
                                    label = if (videoPlaying) "Pause" else "Play",
                                    icon = if (videoPlaying) null else Icons.Filled.PlayArrow) {
                                    if (videoPlaying) PauseGlyph(Modifier.size(18.dp), LocalContentColorOrWhite())
                                }
                                GlassButton(onClick = { player.seekTo((player.currentPosition - 10_000).coerceAtLeast(0)) }, label = "−10 s")
                                GlassButton(onClick = { player.seekTo(player.currentPosition + 10_000) }, label = "+10 s")
                            } else {
                                GlassButton(onClick = { chrome = false; slideshow = true }, label = "Slideshow", icon = Icons.Filled.PlayArrow,
                                    modifier = Modifier.focusRequester(barFocus))
                                if (asset?.isLivePhoto == true) {
                                    GlassButton(onClick = { livePlaying = true; chrome = false }, label = "Live") {
                                        LiveGlyph(Modifier.size(18.dp), LocalContentColorOrWhite())
                                    }
                                }
                            }
                            GlassButton(onClick = ::toggleFavorite, icon = if (asset?.isFavorite == true) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                                label = if (asset?.isFavorite == true) "Favorite" else null)
                            GlassButton(onClick = { info = true }, icon = Icons.Filled.Info)
                        }
                    }
                    if (asset?.isVideo == true) VideoProgress(player, Modifier.align(Alignment.BottomCenter).padding(bottom = 6.dp))
                }
            }

            // Info: a sheet from the right, over the photo.
            AnimatedVisibility(
                info && asset != null,
                enter = slideInHorizontally { it } + fadeIn(),
                exit = slideOutHorizontally { it } + fadeOut(),
                modifier = Modifier.align(Alignment.CenterEnd).zIndex(2f),
            ) {
                val a = asset ?: return@AnimatedVisibility
                LaunchedEffect(a.id) {
                    if (details[a.id] == null) runCatching { service.detail(a.id) }.onSuccess { details[a.id] = it }
                }
                InfoPanel(a, details[a.id], onClose = { info = false })
            }
        }
        LaunchedEffect(Unit) { runCatching { rootFocus.requestFocus() } }
    }
}

@Composable
private fun LocalContentColorOrWhite(): Color = androidx.tv.material3.LocalContentColor.current

@Composable
private fun PhotoPage(asset: Asset, kenBurns: Boolean) {
    var t by remember(asset.id) { mutableFloatStateOf(0f) }
    LaunchedEffect(asset.id, kenBurns) {
        if (!kenBurns) { t = 0f; return@LaunchedEffect }
        val start = System.nanoTime()
        while (true) {
            t = ((System.nanoTime() - start) / 1e6f / (SLIDE_MS + 900)).coerceAtMost(1f)
            if (t >= 1f) break
            delay(16)
        }
    }
    val zoom = 1f + 0.08f * t
    val pan = (if (asset.id.hashCode() % 2 == 0) 1 else -1) * 18f * t
    Box(
        Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = pan },
        contentAlignment = Alignment.Center,
    ) {
        // The grid thumbnail is in cache already: it shows instantly, the preview sharpens it.
        AsyncImage(service.image(asset.id, ImageSize.Thumbnail, asset.thumbhash), null,
            Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
        AsyncImage(service.image(asset.id, ImageSize.Preview, asset.thumbhash), null,
            Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun VideoSurface(player: ExoPlayer, ratio: Float) {
    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                useController = false
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
                layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                this.player = player
            }
        },
        onRelease = { it.player = null },
        modifier = Modifier.fillMaxSize().aspectRatio(ratio.coerceIn(0.3f, 3f), matchHeightConstraintsFirst = ratio < 16f / 9f),
    )
}

@Composable
private fun VideoProgress(player: ExoPlayer, modifier: Modifier = Modifier) {
    var pos by remember { mutableLongStateOf(0L) }
    var dur by remember { mutableLongStateOf(0L) }
    LaunchedEffect(player) {
        while (true) {
            pos = player.currentPosition
            dur = player.duration.coerceAtLeast(0)
            delay(250)
        }
    }
    Row(modifier.width(560.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(fmt(pos), style = Type.caption)
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f).height(4.dp).clip(CircleShape).background(C.label.copy(alpha = 0.25f))) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(if (dur > 0) (pos.toFloat() / dur).coerceIn(0f, 1f) else 0f).background(C.label))
        }
        Spacer(Modifier.width(10.dp))
        Text(fmt(dur), style = Type.caption)
    }
}

private fun fmt(ms: Long): String {
    val s = (ms / 1000).toInt()
    return if (s >= 3600) "%d:%02d:%02d".format(s / 3600, (s % 3600) / 60, s % 60) else "%d:%02d".format(s / 60, s % 60)
}

/** Neighbouring thumbnails; focusing one shows it, like scrubbing on tvOS. */
@Composable
private fun Filmstrip(source: it.davideghiotto.memoriestv.data.AssetSource, index: Int, onPick: (Int) -> Unit) {
    val window = 40
    val lo = (index - window).coerceAtLeast(0)
    val hi = (index + window).coerceAtMost(source.count - 1)
    val state = rememberLazyListState()
    LaunchedEffect(index) { state.animateScrollToItem((index - lo - 6).coerceAtLeast(0)) }
    LazyRow(
        state = state,
        modifier = Modifier.fillMaxWidth().height(56.dp),
        contentPadding = PaddingValues(horizontal = 48.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        items(hi - lo + 1, key = { lo + it }) { k ->
            val i = lo + k
            val a = source.asset(i)
            LaunchedEffect(i, a == null) { if (a == null) source.ensure(i) }
            val current = i == index
            Tile(
                onClick = { onPick(i) },
                modifier = Modifier
                    .size(width = if (current) 64.dp else 40.dp, height = if (current) 52.dp else 44.dp)
                    .onFocusChanged { if (it.isFocused && i != index) onPick(i) },
                shape = RoundedCornerShape(if (current) 6.dp else 4.dp),
                focusedScale = 1.08f,
            ) { AssetPicture(a, Modifier.fillMaxSize()) }
        }
    }
}

@Composable
private fun InfoPanel(asset: Asset, d: AssetDetail?, onClose: () -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(
        Modifier
            .fillMaxHeight()
            .width(380.dp)
            .padding(20.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(C.card.copy(alpha = 0.94f))
            .verticalScroll(rememberScrollState())
            .padding(22.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        d?.description?.let { Text(it, style = Type.body) }
        Column {
            Text(Dates.weekdayDate(asset.local), style = Type.headline)
            Text(Dates.time(asset.local) + (d?.let { " · ${it.fileName}" } ?: ""), style = Type.subhead)
        }
        // Camera card.
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.raised)) {
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(listOfNotNull(d?.make, d?.model).joinToString(" ").ifEmpty { if (d == null) "…" else "Unknown camera" },
                    style = Type.headline.copy(fontSize = 14.sp), modifier = Modifier.weight(1f))
                d?.mimeType?.substringAfter('/')?.uppercase()?.let {
                    Text(it, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = C.label2,
                        modifier = Modifier.background(C.label2.copy(alpha = 0.2f), RoundedCornerShape(4.dp)).padding(horizontal = 6.dp, vertical = 2.dp))
                }
            }
            Box(Modifier.fillMaxWidth().height(0.5.dp).background(C.separator))
            Column(Modifier.padding(12.dp)) {
                d?.lens?.let { Text(it, style = Type.caption.copy(color = C.label)) }
                Text(resolution(d), style = Type.caption)
            }
            Box(Modifier.fillMaxWidth().height(0.5.dp).background(C.separator))
            Row(Modifier.padding(vertical = 10.dp)) {
                listOf(
                    d?.iso?.let { "ISO $it" },
                    d?.focalLength?.let { "%s mm".format(trim(it)) },
                    d?.fNumber?.let { "ƒ%s".format(trim(it)) },
                    d?.exposure?.let { "$it s" },
                ).forEach { Text(it ?: "—", style = Type.caption, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
            }
        }
        if (!d?.people.isNullOrEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("People", style = Type.headline)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    d.people.take(5).forEach { p ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.width(56.dp)) {
                            AsyncImage(service.personImage(p.id), null, Modifier.size(48.dp).clip(CircleShape).background(C.placeholder),
                                contentScale = ContentScale.Crop)
                            Text(p.name, style = Type.caption, maxLines = 1)
                        }
                    }
                }
            }
        }
        asset.place?.let {
            Column {
                Text("Place", style = Type.headline)
                Text(it, style = Type.subhead)
            }
        }
        GlassButton(onClick = onClose, label = "Close", modifier = Modifier.focusRequester(focus))
    }
}

private fun trim(v: Double) = if (v == v.toLong().toDouble()) v.toLong().toString() else "%.1f".format(v)

private fun resolution(d: AssetDetail?): String {
    if (d == null) return " "
    val parts = mutableListOf<String>()
    if (d.width != null && d.height != null) parts += "%.0f MP · %d × %d".format(d.width * d.height / 1_000_000.0, d.width, d.height)
    d.fileSize?.let { parts += android.text.format.Formatter.formatShortFileSize(MemoriesApp.instance, it) }
    return parts.joinToString(" · ").ifEmpty { " " }
}
