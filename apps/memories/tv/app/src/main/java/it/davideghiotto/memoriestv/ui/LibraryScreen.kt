package it.davideghiotto.memoriestv.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import it.davideghiotto.memoriestv.LaunchOptions
import it.davideghiotto.memoriestv.data.Asset
import it.davideghiotto.memoriestv.data.Bucket
import it.davideghiotto.memoriestv.data.Dates
import it.davideghiotto.memoriestv.data.ImageSize
import it.davideghiotto.memoriestv.data.TimelineStore
import kotlinx.coroutines.launch

enum class LibraryMode(val title: String) { Years("Years"), Months("Months"), All("All") }

private val columnSteps = listOf(4, 6, 8)

/**
 * Library: the iOS Years · Months · All, with the segmented control in the header (a remote
 * reaches the top of the screen more easily than a floating bottom bar). The header shows the
 * focused photo's month and place, like the iOS header while scrolling.
 */
@Composable
fun LibraryScreen(nav: Nav, store: TimelineStore, launch: LaunchOptions) {
    val scope = rememberCoroutineScope()
    var mode by rememberSaveable { mutableStateOf(when (launch.mode) { "years" -> LibraryMode.Years; "months" -> LibraryMode.Months; else -> LibraryMode.All }) }
    var columns by rememberSaveable { mutableIntStateOf(6) }
    var focusedIndex by remember { mutableIntStateOf(-1) }
    val focused = if (focusedIndex >= 0) store.asset(focusedIndex) else null
    val gridState = rememberLazyGridState()
    val monthsState = rememberLazyGridState()
    val yearsState = rememberLazyGridState()
    val focusTarget = remember { FocusTarget() }
    var monthFocus by remember { mutableIntStateOf(-1) }

    LaunchedEffect(store) {
        store.load()
        if (launch.openViewer && store.count > 0) {
            store.ensure(0)
            nav.open(store, 0)
        } else if (store.count > 0 && gridState.firstVisibleItemIndex == 0) {
            focusTarget.index = 0
        }
    }

    Column(Modifier.fillMaxSize()) {
        val title = when (mode) {
            LibraryMode.All -> focused?.let { Dates.monthYear(it.local.toLocalDate()) } ?: "Library"
            else -> "Library"
        }
        val subtitle = when {
            mode != LibraryMode.All -> if (store.count > 0) "${"%,d".format(store.count)} Items" else null
            focused != null -> focused.place ?: Dates.dayMonthYear(focused.local)
            store.count > 0 -> "${"%,d".format(store.count)} Items"
            else -> null
        }
        Header(title, subtitle, Modifier.padding(start = 48.dp, end = 48.dp, top = 6.dp, bottom = 6.dp)) {
            if (mode == LibraryMode.All) {
                GlassButton(
                    onClick = { columns = columnSteps[(columnSteps.indexOf(columns) + 1) % columnSteps.size] },
                    label = "$columns Columns",
                )
            }
            Segmented(
                LibraryMode.entries.map { it to it.title },
                selected = mode,
                onSelect = { mode = it },
            )
        }
        Box(Modifier.weight(1f)) {
            when {
                !store.hasLoaded -> Loading()
                store.error != null && store.count == 0 -> Message("Can't Load Library", store.error, Icons.Filled.Warning) {
                    GlassButton(onClick = { scope.launch { store.reload() } }, label = "Try Again", icon = Icons.Filled.Refresh)
                }
                store.count == 0 -> Message("No Photos or Videos", "Photos you back up or upload to Immich appear here.")
                else -> when (mode) {
                    LibraryMode.All -> TimelineGrid(
                        store, nav, columns, gridState, focusTarget,
                        modifier = Modifier.fillMaxSize(),
                        onFocused = { focusedIndex = it },
                    )
                    LibraryMode.Months -> MonthsGrid(store, monthsState, monthFocus) { b ->
                        mode = LibraryMode.All
                        scope.launch {
                            val start = store.startOf(b)
                            gridState.scrollToItem(start + b)
                            focusTarget.index = start
                        }
                    }
                    LibraryMode.Years -> YearsGrid(store, yearsState) { firstBucket ->
                        mode = LibraryMode.Months
                        monthFocus = firstBucket
                        scope.launch { monthsState.scrollToItem(firstBucket) }
                    }
                }
            }
        }
    }
}

/** One card per month: key photo, "May 2024", the place. */
@Composable
private fun MonthsGrid(store: TimelineStore, state: androidx.compose.foundation.lazy.grid.LazyGridState, focusIndex: Int, onOpen: (Int) -> Unit) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(3),
        state = state,
        contentPadding = PaddingValues(horizontal = 48.dp, vertical = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(20.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        itemsIndexed(store.buckets, key = { _, b -> b.key }) { i, bucket ->
            val requester = remember { FocusRequester() }
            LaunchedEffect(focusIndex) { if (focusIndex == i) runCatching { requester.requestFocus() } }
            MonthCard(store, bucket, Modifier.focusRequester(requester)) { onOpen(i) }
        }
    }
}

@Composable
private fun MonthCard(store: TimelineStore, bucket: Bucket, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val assets = store.monthAssets(bucket.key)
    LaunchedEffect(bucket.key) { store.ensureMonth(bucket.key) }
    val key = assets?.let { keyPhoto(it) }
    Tile(onClick = onClick, modifier = modifier.fillMaxWidth().aspectRatio(16f / 10f), shape = RoundedCornerShape(R.card), focusedScale = 1.06f) {
        Box(Modifier.fillMaxSize()) {
            AssetPicture(key, Modifier.fillMaxSize(), size = ImageSize.Preview)
            Box(Modifier.fillMaxSize().bottomScrim())
            Column(Modifier.align(Alignment.BottomStart).padding(14.dp)) {
                Text(Dates.monthYear(bucket.month), fontSize = 20.sp, fontWeight = FontWeight.Bold, color = C.label)
                Text(assets?.let { mostCommonPlace(it) } ?: "${bucket.count} Items", style = Type.subhead.copy(color = C.label.copy(alpha = 0.85f)))
            }
        }
    }
}

/** One card per year, the year in big type over its key photo. */
@Composable
private fun YearsGrid(store: TimelineStore, state: androidx.compose.foundation.lazy.grid.LazyGridState, onOpen: (Int) -> Unit) {
    val years = remember(store.buckets) {
        store.buckets.withIndex().groupBy { it.value.month.year }.map { (year, list) -> Triple(year, list.first().index, list.sumOf { it.value.count }) }
    }
    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        state = state,
        contentPadding = PaddingValues(horizontal = 48.dp, vertical = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        itemsIndexed(years, key = { _, y -> y.first }) { _, (year, firstBucket, count) ->
            val bucket = store.buckets[firstBucket]
            val assets = store.monthAssets(bucket.key)
            LaunchedEffect(bucket.key) { store.ensureMonth(bucket.key) }
            Tile(onClick = { onOpen(firstBucket) }, modifier = Modifier.fillMaxWidth().aspectRatio(16f / 9f),
                shape = RoundedCornerShape(R.card), focusedScale = 1.05f) {
                Box(Modifier.fillMaxSize()) {
                    AssetPicture(assets?.let { keyPhoto(it) }, Modifier.fillMaxSize(), size = ImageSize.Preview)
                    Box(Modifier.fillMaxSize().topScrim())
                    Column(Modifier.align(Alignment.TopStart).padding(18.dp)) {
                        Text("$year", fontSize = 40.sp, fontWeight = FontWeight.Bold, color = C.label)
                        Text("${"%,d".format(count)} Items", style = Type.subhead.copy(color = C.label.copy(alpha = 0.85f)))
                    }
                }
            }
        }
    }
}

/** A photo rather than a video, a favorite if there is one. */
private fun keyPhoto(list: List<Asset>): Asset? =
    list.firstOrNull { it.isFavorite && it.isImage } ?: list.firstOrNull { it.isImage } ?: list.firstOrNull()
