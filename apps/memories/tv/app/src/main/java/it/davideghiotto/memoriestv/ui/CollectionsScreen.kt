package it.davideghiotto.memoriestv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil3.compose.AsyncImage
import it.davideghiotto.memoriestv.data.Album
import it.davideghiotto.memoriestv.data.ImageSize
import it.davideghiotto.memoriestv.data.ListQuery
import it.davideghiotto.memoriestv.data.Memory
import it.davideghiotto.memoriestv.data.Person
import it.davideghiotto.memoriestv.data.Place
import it.davideghiotto.memoriestv.data.TimelineQuery

private class CollectionsData {
    var memories by mutableStateOf<List<Memory>?>(null)
    var albums by mutableStateOf<List<Album>?>(null)
    var people by mutableStateOf<List<Person>?>(null)
    var places by mutableStateOf<List<Place>?>(null)
    var error by mutableStateOf<String?>(null)
}

private val RowPadding = PaddingValues(horizontal = 48.dp)

/**
 * Collections, as on iOS: Memories, Pinned, Albums, People, Places, one row each. Each row ends
 * in a "See All" tile where there is more (a remote can't tap the section title).
 */
@Composable
fun CollectionsScreen(nav: Nav) {
    val data = remember { CollectionsData() }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        data.error = null
        runCatching { data.memories = service.memories() }.onFailure { data.memories = emptyList(); data.error = it.message }
        runCatching { data.albums = service.albums() }.onFailure { data.albums = emptyList(); data.error = it.message }
        runCatching { data.people = service.people() }.onFailure { data.people = emptyList() }
        runCatching { data.places = service.places() }.onFailure { data.places = emptyList() }
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(top = 8.dp, bottom = 48.dp),
        verticalArrangement = Arrangement.spacedBy(26.dp),
    ) {
        item {
            Header("Collections", data.error?.let { "Some sections couldn't load: $it" },
                Modifier.padding(horizontal = 48.dp)) {
                if (data.error != null) GlassButton(onClick = { attempt++ }, icon = Icons.Filled.Refresh)
            }
        }

        val memories = data.memories
        if (!memories.isNullOrEmpty()) item {
            Section("Memories") {
                LazyRow(contentPadding = RowPadding, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    items(memories, key = { it.id }) { m -> MemoryCard(m) { nav.play(m) } }
                }
            }
        }

        item {
            Section("Pinned", chevron = false) {
                LazyRow(contentPadding = RowPadding, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    item { PinnedCard("Favorites", Icons.Filled.Favorite, listOf(Color(0xFFFF6F91), Color(0xFFB0385C))) {
                        nav.push(Route.Timeline("Favorites", TimelineQuery.Favorites)) } }
                    item { PinnedCard("Recently Saved", Icons.Filled.DateRange, listOf(Color(0xFF4E80EE), Color(0xFF1B2A6A))) {
                        nav.push(Route.Results("Recently Saved", ListQuery.RecentlyAdded)) } }
                    item { PinnedCard("Videos", Icons.Filled.PlayArrow, listOf(Color(0xFFFFB36B), Color(0xFFB4562E))) {
                        nav.push(Route.Results("Videos", ListQuery.Videos)) } }
                }
            }
        }

        item {
            val albums = data.albums
            Section("Albums") {
                when {
                    albums == null -> Placeholders(160.dp, 1f)
                    albums.isEmpty() -> Text("No albums yet.", style = Type.subhead, modifier = Modifier.padding(RowPadding))
                    else -> LazyRow(contentPadding = RowPadding, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                        items(albums.take(12), key = { it.id }) { a -> AlbumCard(a, nav) }
                        if (albums.size > 12) item { SeeAll(160.dp, 160.dp) { nav.push(Route.Albums) } }
                    }
                }
            }
        }

        val people = data.people
        if (!people.isNullOrEmpty()) item {
            Section("People & Pets") {
                LazyRow(contentPadding = RowPadding, horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                    items(people.filter { it.name.isNotBlank() }.take(16), key = { it.id }) { p -> PersonCircle(p, nav) }
                    item { SeeAll(96.dp, 96.dp, CircleShape) { nav.push(Route.People) } }
                }
            }
        }

        val places = data.places
        if (!places.isNullOrEmpty()) item {
            Section("Places") {
                LazyRow(contentPadding = RowPadding, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                    items(places.take(20), key = { it.name }) { p ->
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Tile(onClick = { nav.push(Route.Results(p.name, ListQuery.City(p.name))) },
                                modifier = Modifier.width(200.dp).aspectRatio(4f / 3f), shape = RoundedCornerShape(R.cover), focusedScale = 1.06f) {
                                Box(Modifier.fillMaxSize()) {
                                    AssetPicture(p.asset, Modifier.fillMaxSize(), size = ImageSize.Preview)
                                    Box(Modifier.fillMaxSize().bottomScrim())
                                    Text(p.name, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = C.label,
                                        modifier = Modifier.align(Alignment.BottomStart).padding(10.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, chevron: Boolean = true, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SectionTitle(title, Modifier.padding(horizontal = 48.dp), chevron)
        content()
    }
}

@Composable
private fun Placeholders(height: Dp, ratio: Float) {
    LazyRow(contentPadding = RowPadding, horizontalArrangement = Arrangement.spacedBy(18.dp), userScrollEnabled = false) {
        items(5) { Box(Modifier.size(height * ratio, height).background(C.card, RoundedCornerShape(R.cover))) }
    }
}

/** A tall 3:4 card, title and year over the key photo. */
@Composable
private fun MemoryCard(m: Memory, onClick: () -> Unit) {
    Tile(onClick = onClick, modifier = Modifier.width(210.dp).aspectRatio(3f / 4f), shape = RoundedCornerShape(R.card), focusedScale = 1.06f) {
        Box(Modifier.fillMaxSize()) {
            AssetPicture(m.assets.firstOrNull { it.isImage } ?: m.assets.first(), Modifier.fillMaxSize(), size = ImageSize.Preview)
            Box(Modifier.fillMaxSize().bottomScrim())
            Column(Modifier.align(Alignment.BottomStart).padding(14.dp)) {
                Text(m.title, fontSize = 19.sp, fontWeight = FontWeight.Bold, color = C.label)
                Text("${m.year}", style = Type.subhead.copy(color = C.label.copy(alpha = 0.85f)))
            }
        }
    }
}

@Composable
private fun PinnedCard(title: String, icon: ImageVector, colors: List<Color>, onClick: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Tile(onClick = onClick, modifier = Modifier.size(180.dp, 120.dp), shape = RoundedCornerShape(R.cover), focusedScale = 1.06f) {
            Box(Modifier.fillMaxSize().background(Brush.linearGradient(colors)), contentAlignment = Alignment.Center) {
                Icon(icon, null, tint = C.label, modifier = Modifier.size(36.dp))
            }
        }
        Text(title, style = Type.headline.copy(fontSize = 14.sp))
    }
}

@Composable
fun AlbumCard(a: Album, nav: Nav, side: Dp = 160.dp) {
    Column(Modifier.width(side), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Tile(onClick = { nav.push(Route.Timeline(a.name, TimelineQuery.Album(a.id), "${a.count} Items")) },
            modifier = Modifier.size(side), shape = RoundedCornerShape(R.cover), focusedScale = 1.06f) {
            if (a.thumbnailAssetId != null) {
                AsyncImage(service.image(a.thumbnailAssetId, ImageSize.Thumbnail), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            }
        }
        Text(a.name, style = Type.headline.copy(fontSize = 14.sp), maxLines = 1)
        Text("${a.count}", style = Type.caption)
    }
}

@Composable
fun PersonCircle(p: Person, nav: Nav, side: Dp = 96.dp) {
    Column(Modifier.width(side), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Tile(onClick = { nav.push(Route.Timeline(p.name.ifBlank { "Person" }, TimelineQuery.Person(p.id))) },
            modifier = Modifier.size(side), shape = CircleShape, focusedScale = 1.08f) {
            AsyncImage(service.personImage(p.id), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
        Text(p.name, style = Type.subhead.copy(color = C.label), maxLines = 1)
    }
}

@Composable
private fun SeeAll(w: Dp, h: Dp, shape: androidx.compose.ui.graphics.Shape = RoundedCornerShape(R.cover), onClick: () -> Unit) {
    Tile(onClick = onClick, modifier = Modifier.size(w, h), shape = shape, focusedScale = 1.06f) {
        Box(Modifier.fillMaxSize().background(C.card), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = C.label2, modifier = Modifier.size(30.dp))
                Text("See All", style = Type.subhead)
            }
        }
    }
}

@Composable
fun AlbumsScreen(nav: Nav) {
    var albums by remember { mutableStateOf<List<Album>?>(null) }
    LaunchedEffect(Unit) { albums = runCatching { service.albums() }.getOrDefault(emptyList()) }
    Column(Modifier.fillMaxSize()) {
        Header("Albums", albums?.let { "${it.size} Albums" }, Modifier.padding(start = 48.dp, end = 48.dp, top = 28.dp, bottom = 8.dp)) {
            GlassButton(onClick = { nav.back() }, icon = Icons.AutoMirrored.Filled.ArrowBack)
        }
        val list = albums
        if (list == null) Loading() else LazyVerticalGrid(
            GridCells.Adaptive(150.dp),
            contentPadding = PaddingValues(horizontal = 48.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            items(list, key = { it.id }) { AlbumCard(it, nav, 150.dp) }
        }
    }
}

@Composable
fun PeopleScreen(nav: Nav) {
    var people by remember { mutableStateOf<List<Person>?>(null) }
    LaunchedEffect(Unit) { people = runCatching { service.people() }.getOrDefault(emptyList()).filter { it.name.isNotBlank() } }
    Column(Modifier.fillMaxSize()) {
        Header("People & Pets", null, Modifier.padding(start = 48.dp, end = 48.dp, top = 28.dp, bottom = 8.dp)) {
            GlassButton(onClick = { nav.back() }, icon = Icons.AutoMirrored.Filled.ArrowBack)
        }
        val list = people
        if (list == null) Loading() else LazyVerticalGrid(
            GridCells.Adaptive(110.dp),
            contentPadding = PaddingValues(horizontal = 48.dp, vertical = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            items(list, key = { it.id }) { PersonCircle(it, nav, 100.dp) }
        }
    }
}
