package it.davideghiotto.memoriestv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.unit.dp
import androidx.compose.ui.zIndex
import androidx.tv.material3.Text
import it.davideghiotto.memoriestv.data.Asset
import it.davideghiotto.memoriestv.data.AssetSource
import it.davideghiotto.memoriestv.data.Dates
import it.davideghiotto.memoriestv.data.ListStore
import it.davideghiotto.memoriestv.data.TimelineStore
import kotlinx.coroutines.launch

/** Gutters: iOS uses 1–2 px; the TV needs a hair more so the focus lift reads. */
val Gutter = 4.dp

/** Asks a cell to take focus once it is composed (after the viewer closes, after a jump). */
class FocusTarget {
    var index by mutableIntStateOf(-1)
}

/** One square cell: thumbhash, thumbnail, badges; asks its month to load. */
@Composable
fun GridCell(
    source: AssetSource,
    index: Int,
    focusTarget: FocusTarget,
    onOpen: (Int) -> Unit,
    onFocused: (Int) -> Unit,
) {
    val asset = source.asset(index)
    LaunchedEffect(index, asset == null) { if (asset == null) source.ensure(index) }
    var focused by remember { mutableStateOf(false) }
    val requester = remember { FocusRequester() }
    LaunchedEffect(focusTarget.index) {
        if (focusTarget.index == index) {
            runCatching { requester.requestFocus() }
            focusTarget.index = -1
        }
    }
    Tile(
        onClick = { if (asset != null) onOpen(index) },
        modifier = Modifier
            .aspectRatio(1f)
            .zIndex(if (focused) 1f else 0f)
            .focusRequester(requester)
            .onFocusChanged {
                focused = it.isFocused
                if (it.isFocused) onFocused(index)
            },
    ) {
        Box(Modifier.fillMaxSize()) {
            AssetPicture(asset, Modifier.fillMaxSize())
            if (asset != null) Badges(asset, compact = true)
        }
    }
}

/**
 * The library grid: every month header and cell laid out up front from the bucket counts, newest
 * first. Grid position of global index g in month b is `g + b + 1` (headers come first).
 */
@Composable
fun TimelineGrid(
    store: TimelineStore,
    nav: Nav,
    columns: Int,
    state: LazyGridState,
    focusTarget: FocusTarget,
    modifier: Modifier = Modifier,
    contentPadding: PaddingValues = PaddingValues(horizontal = 48.dp, vertical = 12.dp),
    onFocused: (Int) -> Unit = {},
) {
    val scope = rememberCoroutineScope()
    DisposableEffect(store, columns) {
        val cb: (AssetSource, Int) -> Unit = { source, end ->
            if (source === store && end in 0 until store.count) {
                val b = store.bucketIndex(end)
                scope.launch {
                    state.scrollToItem((end + b + 1 - columns).coerceAtLeast(0))
                    focusTarget.index = end
                }
            }
        }
        nav.onViewerClosed = cb
        onDispose { if (nav.onViewerClosed === cb) nav.onViewerClosed = null }
    }
    LazyVerticalGrid(
        columns = GridCells.Fixed(columns),
        state = state,
        modifier = modifier,
        contentPadding = contentPadding,
        horizontalArrangement = Arrangement.spacedBy(Gutter),
        verticalArrangement = Arrangement.spacedBy(Gutter),
    ) {
        store.buckets.forEachIndexed { b, bucket ->
            item(key = "h-${bucket.key}", span = { GridItemSpan(maxLineSpan) }, contentType = "header") {
                val month = store.monthAssets(bucket.key)
                val place = month?.let { mostCommonPlace(it) }
                Row(Modifier.fillMaxWidth().padding(top = if (b == 0) 4.dp else 18.dp, bottom = 6.dp)) {
                    Text(Dates.monthYear(bucket.month), style = Type.headline)
                    if (place != null) Text("  ·  $place", style = Type.subhead)
                }
            }
            val start = store.startOf(b)
            items(bucket.count, key = { "${bucket.key}-$it" }, contentType = { "cell" }) { i ->
                GridCell(store, start + i, focusTarget, onOpen = { nav.open(store, it) }, onFocused = onFocused)
            }
        }
    }
}

/** A search or media-type result: a flat grid, pages loading near the end. */
@Composable
fun ListGrid(
    store: ListStore,
    nav: Nav,
    columns: Int = 6,
    modifier: Modifier = Modifier,
    state: LazyGridState = rememberLazyGridState(),
    contentPadding: PaddingValues = PaddingValues(horizontal = 48.dp, vertical = 12.dp),
) {
    val focusTarget = remember { FocusTarget() }
    val scope = rememberCoroutineScope()
    DisposableEffect(store) {
        val cb: (AssetSource, Int) -> Unit = { source, end ->
            if (source === store && end in 0 until store.count) scope.launch {
                state.scrollToItem((end - columns).coerceAtLeast(0))
                focusTarget.index = end
            }
        }
        nav.onViewerClosed = cb
        onDispose { if (nav.onViewerClosed === cb) nav.onViewerClosed = null }
    }
    LazyVerticalGrid(
        columns = GridCells.Fixed(columns),
        state = state,
        modifier = modifier,
        contentPadding = contentPadding,
        horizontalArrangement = Arrangement.spacedBy(Gutter),
        verticalArrangement = Arrangement.spacedBy(Gutter),
    ) {
        items(store.items.size, key = { store.items[it].id }) { i ->
            GridCell(store, i, focusTarget, onOpen = { nav.open(store, it) }, onFocused = {})
        }
    }
}

fun mostCommonPlace(list: List<Asset>): String? =
    list.mapNotNull { it.city ?: it.country }.groupingBy { it }.eachCount().maxByOrNull { it.value }?.key

/** Album, person, favorites: header with back, Play (slideshow) and the grid. */
@Composable
fun TimelineScreen(nav: Nav, route: Route.Timeline) {
    val scope = rememberCoroutineScope()
    val store = remember(route) { TimelineStore(service, route.query, scope) }
    val state = rememberLazyGridState()
    val focusTarget = remember { FocusTarget() }
    LaunchedEffect(store) { store.load() }
    Column(Modifier.fillMaxSize()) {
        Header(
            title = route.title,
            subtitle = route.subtitle ?: if (store.hasLoaded) "${store.count} Items" else null,
            modifier = Modifier.padding(start = 48.dp, end = 48.dp, top = 28.dp, bottom = 8.dp),
        ) {
            if (store.count > 0) {
                GlassButton(onClick = { nav.open(store, 0, slideshow = true) }, label = "Slideshow", icon = Icons.Filled.PlayArrow)
            }
            GlassButton(onClick = { nav.back() }, icon = Icons.AutoMirrored.Filled.ArrowBack)
        }
        when {
            !store.hasLoaded -> Loading()
            store.error != null && store.count == 0 -> Message("Can't Load", store.error, Icons.Filled.Warning) {
                GlassButton(onClick = { scope.launch { store.reload() } }, label = "Try Again", icon = Icons.Filled.Refresh)
            }
            store.count == 0 -> Message("No Photos or Videos")
            else -> TimelineGrid(store, nav, columns = 6, state = state, focusTarget = focusTarget, modifier = Modifier.fillMaxSize())
        }
    }
    LaunchedEffect(store.hasLoaded) { if (store.count > 0) focusTarget.index = 0 }
}

/** Videos, recently added, a city, a smart search. */
@Composable
fun ResultsScreen(nav: Nav, route: Route.Results) {
    val scope = rememberCoroutineScope()
    val store = remember(route) { ListStore(service, route.query, scope) }
    LaunchedEffect(store) { store.loadMore() }
    Column(Modifier.fillMaxSize()) {
        Header(
            title = route.title,
            subtitle = if (store.hasLoaded) "${store.count}${if (store.count >= 100) "+" else ""} Items" else null,
            modifier = Modifier.padding(start = 48.dp, end = 48.dp, top = 28.dp, bottom = 8.dp),
        ) {
            if (store.count > 0) {
                GlassButton(onClick = { nav.open(store, 0, slideshow = true) }, label = "Slideshow", icon = Icons.Filled.PlayArrow)
            }
            GlassButton(onClick = { nav.back() }, icon = Icons.AutoMirrored.Filled.ArrowBack)
        }
        when {
            !store.hasLoaded -> Loading()
            store.error != null && store.count == 0 -> Message("Can't Load", store.error, Icons.Filled.Warning)
            store.count == 0 -> Message("No Results")
            else -> ListGrid(store, nav, modifier = Modifier.fillMaxSize())
        }
    }
}
