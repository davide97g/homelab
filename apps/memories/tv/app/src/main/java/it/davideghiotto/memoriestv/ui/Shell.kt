package it.davideghiotto.memoriestv.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import it.davideghiotto.memoriestv.LaunchOptions
import it.davideghiotto.memoriestv.MemoriesApp
import it.davideghiotto.memoriestv.data.AssetSource
import it.davideghiotto.memoriestv.data.ListQuery
import it.davideghiotto.memoriestv.data.Memory
import it.davideghiotto.memoriestv.data.TimelineQuery
import it.davideghiotto.memoriestv.data.TimelineStore
import kotlinx.coroutines.CoroutineScope

enum class Tab(val title: String) { Library("Library"), Collections("Collections"), Search("Search") }

sealed interface Route {
    data class Timeline(val title: String, val query: TimelineQuery, val subtitle: String? = null) : Route
    data class Results(val title: String, val query: ListQuery) : Route
    data object Albums : Route
    data object People : Route
    data object Settings : Route
}

/** Full-screen layers drawn over everything (their own windows, so focus stays inside). */
sealed interface Overlay {
    data class Viewer(val source: AssetSource, val index: Int, val slideshow: Boolean = false) : Overlay
    data class PlayMemory(val memory: Memory) : Overlay
}

class Nav(val scope: CoroutineScope, startTab: Tab) {
    var tab by mutableStateOf(startTab)
    val stack = mutableStateListOf<Route>()
    var overlay by mutableStateOf<Overlay?>(null)
    /** Called when the viewer closes, with the index it ended on (the grid scrolls there). */
    var onViewerClosed: ((AssetSource, Int) -> Unit)? = null

    fun push(r: Route) { stack.add(r) }
    fun back(): Boolean = if (stack.isNotEmpty()) { stack.removeAt(stack.lastIndex); true } else false
    fun open(source: AssetSource, index: Int, slideshow: Boolean = false) { overlay = Overlay.Viewer(source, index, slideshow) }
    fun play(memory: Memory) { overlay = Overlay.PlayMemory(memory) }
}

/**
 * Library · Collections · Search, as a glass capsule at the top (tvOS puts tabs up there; the iOS
 * app floats them at the bottom). Pushed screens replace the content; the viewer and the memory
 * player are full-screen dialogs over it.
 */
@Composable
fun Shell(launch: LaunchOptions) {
    val scope = rememberCoroutineScope()
    val nav = remember {
        Nav(scope, when (launch.tab) { "collections" -> Tab.Collections; "search" -> Tab.Search; else -> Tab.Library })
    }
    // The library timeline outlives tab switches: coming back keeps the scroll position.
    val library = remember { TimelineStore(service, TimelineQuery.Library, scope) }
    val holder = rememberSaveableStateHolder()

    BackHandler(enabled = nav.stack.isNotEmpty()) { nav.back() }

    Box(Modifier.fillMaxSize()) {
        val top = nav.stack.lastOrNull()
        if (top == null) {
            Column(Modifier.fillMaxSize()) {
                TabBar(nav)
                Box(Modifier.weight(1f)) {
                    holder.SaveableStateProvider(nav.tab.name) {
                        when (nav.tab) {
                            Tab.Library -> LibraryScreen(nav, library, launch)
                            Tab.Collections -> CollectionsScreen(nav)
                            Tab.Search -> SearchScreen(nav)
                        }
                    }
                }
            }
        } else {
            holder.SaveableStateProvider("route-${nav.stack.size}-$top") {
                when (top) {
                    is Route.Timeline -> TimelineScreen(nav, top)
                    is Route.Results -> ResultsScreen(nav, top)
                    Route.Albums -> AlbumsScreen(nav)
                    Route.People -> PeopleScreen(nav)
                    Route.Settings -> SettingsScreen(nav)
                }
            }
        }

        when (val o = nav.overlay) {
            is Overlay.Viewer -> ViewerDialog(o, onClose = { end ->
                nav.overlay = null
                nav.onViewerClosed?.invoke(o.source, end)
            })
            is Overlay.PlayMemory -> MemoryPlayerDialog(o.memory, onClose = { nav.overlay = null })
            null -> Unit
        }
    }
}

@Composable
private fun TabBar(nav: Nav) {
    Box(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 6.dp, start = 48.dp, end = 48.dp)) {
        Row(
            Modifier.align(Alignment.Center).glass().padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Tab.entries.forEach { t ->
                val selected = nav.tab == t
                androidx.tv.material3.Surface(
                    onClick = { nav.tab = t },
                    shape = androidx.tv.material3.ClickableSurfaceDefaults.shape(CircleShape),
                    scale = androidx.tv.material3.ClickableSurfaceDefaults.scale(focusedScale = 1f),
                    colors = androidx.tv.material3.ClickableSurfaceDefaults.colors(
                        containerColor = if (selected) C.label.copy(alpha = 0.16f) else Color.Transparent,
                        contentColor = if (selected) C.label else C.label2,
                        focusedContainerColor = C.label,
                        focusedContentColor = C.black,
                    ),
                ) {
                    Row(Modifier.padding(horizontal = 22.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (t == Tab.Search) {
                            Icon(Icons.Filled.Search, null, Modifier.size(18.dp))
                            androidx.compose.foundation.layout.Spacer(Modifier.size(6.dp))
                        }
                        Text(t.title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }
        GlassButton(
            onClick = { nav.push(Route.Settings) },
            modifier = Modifier.align(Alignment.CenterEnd),
        ) { Avatar(MemoriesAppUserName(), 28) }
    }
}

@Composable
private fun MemoriesAppUserName(): String? {
    var name by remember { mutableStateOf(MemoriesApp.instance.prefs.userName) }
    LaunchedEffect(Unit) { if (name == null) name = runCatching { service.me().name }.getOrNull() }
    return name
}

/** Initials in a grey circle, the iOS avatar. */
@Composable
fun Avatar(name: String?, sizeDp: Int) {
    val initials = name?.split(" ")?.filter { it.isNotBlank() }?.take(2)?.joinToString("") { it.take(1).uppercase() }
    Box(
        Modifier.size(sizeDp.dp).background(Brush.linearGradient(listOf(Color(0xFF8E8E93), Color(0xFF636366))), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(initials?.ifEmpty { null } ?: "•", fontSize = (sizeDp * 0.4).sp, fontWeight = FontWeight.SemiBold, color = C.label)
    }
}
