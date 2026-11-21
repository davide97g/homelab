package it.davideghiotto.memoriestv.ui

import android.view.KeyEvent
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Warning
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import it.davideghiotto.memoriestv.data.ListQuery
import it.davideghiotto.memoriestv.data.ListStore

/** What CLIP finds well, as starting points (the iOS suggestion chips). */
private val suggestions = listOf("Beach", "Mountains", "Snow", "Sunset", "Dog", "Food", "Birthday cake", "City at night", "Lake", "Christmas")

/**
 * Smart search (Immich CLIP): a glass search field the remote opens with OK, suggestion chips,
 * then the results grid.
 */
@Composable
fun SearchScreen(nav: Nav) {
    val scope = rememberCoroutineScope()
    var text by rememberSaveable { mutableStateOf("") }
    var submitted by rememberSaveable { mutableStateOf<String?>(null) }
    val store = remember(submitted) { submitted?.let { ListStore(service, ListQuery.Smart(it), scope).also { s -> s.loadMore() } } }

    fun run(q: String) {
        val t = q.trim()
        if (t.isNotEmpty()) { text = t; submitted = t }
    }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 48.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Search", style = Type.largeTitle, modifier = Modifier.width(150.dp))
            SearchField(text, { text = it }, onDone = { run(text) }, modifier = Modifier.weight(1f))
        }
        LazyRow(
            contentPadding = PaddingValues(horizontal = 48.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(suggestions) { s -> GlassButton(onClick = { run(s) }, label = s, selected = s == submitted) }
        }
        Spacer(Modifier.height(4.dp))
        Box(Modifier.weight(1f)) {
            when {
                store == null -> Message("Search Your Library", "Things, places, moments: \"red car\", \"snow in the mountains\".", Icons.Filled.Search)
                !store.hasLoaded -> Loading(label = "Searching…")
                store.error != null && store.count == 0 -> Message("Search Failed", store.error, Icons.Filled.Warning)
                store.count == 0 -> Message("No Results", "Nothing matched \"$submitted\".")
                else -> ListGrid(store, nav, modifier = Modifier.fillMaxSize())
            }
        }
    }
}

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit, onDone: () -> Unit, modifier: Modifier = Modifier) {
    var focused by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = TextStyle(color = C.label, fontSize = 17.sp),
        cursorBrush = SolidColor(C.accent),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onSearch = { onDone() }, onDone = { onDone() }),
        modifier = modifier
            .onFocusChanged { focused = it.isFocused }
            // A single-line field swallows up/down; give them back to the focus system.
            .onPreviewKeyEvent { e ->
                if (e.nativeKeyEvent.action != KeyEvent.ACTION_DOWN) return@onPreviewKeyEvent false
                when (e.nativeKeyEvent.keyCode) {
                    KeyEvent.KEYCODE_DPAD_DOWN -> focusManager.moveFocus(FocusDirection.Down)
                    KeyEvent.KEYCODE_DPAD_UP -> focusManager.moveFocus(FocusDirection.Up)
                    else -> false
                }
            },
        decorationBox = { inner ->
            Row(
                Modifier
                    .height(46.dp)
                    .glass()
                    .border(2.dp, if (focused) C.label else C.hairline, CircleShape)
                    .padding(horizontal = 18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Filled.Search, null, tint = C.label2, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(10.dp))
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text("Photos, People, Places…", color = C.label3, fontSize = 17.sp)
                    inner()
                }
            }
        },
    )
}
