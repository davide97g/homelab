package it.davideghiotto.memoriestv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import androidx.tv.material3.Text
import coil3.SingletonImageLoader
import it.davideghiotto.memoriestv.BuildConfig
import it.davideghiotto.memoriestv.MemoriesApp
import it.davideghiotto.memoriestv.data.User
import kotlinx.coroutines.launch

/** Account and this TV: who is signed in, against which server, and the way out. */
@Composable
fun SettingsScreen(nav: Nav) {
    val app = MemoriesApp.instance
    val scope = rememberCoroutineScope()
    var user by remember { mutableStateOf<User?>(null) }
    LaunchedEffect(Unit) { user = runCatching { service.me() }.getOrNull() }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    Column(Modifier.fillMaxSize().padding(horizontal = 48.dp, vertical = 28.dp)) {
        Header("Settings") { GlassButton(onClick = { nav.back() }, icon = Icons.AutoMirrored.Filled.ArrowBack) }
        Spacer(Modifier.height(24.dp))
        Column(Modifier.width(560.dp).align(Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(
                Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(R.card)).padding(18.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(user?.name ?: app.prefs.userName, 52)
                Spacer(Modifier.width(16.dp))
                Column {
                    Text(user?.name ?: app.prefs.userName ?: "…", style = Type.headline)
                    Text(user?.email.orEmpty(), style = Type.subhead)
                }
            }
            Column(Modifier.fillMaxWidth().background(C.card, RoundedCornerShape(R.card)).padding(vertical = 6.dp)) {
                InfoRow("Server", if (service.isMock) "Sample library" else app.prefs.apiUrl?.removeSuffix("/api") ?: "—")
                Divider()
                InfoRow("Signed in with", if (service.isMock) "—" else "accounts.davideghiotto.it")
                Divider()
                InfoRow("Version", BuildConfig.VERSION_NAME)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                GlassButton(onClick = { SingletonImageLoader.get(app).let { it.memoryCache?.clear(); it.diskCache?.clear() } },
                    label = "Clear Image Cache", modifier = Modifier.focusRequester(focus))
                GlassButton(onClick = { scope.launch { app.signOut() } },
                    label = if (service.isMock) "Leave Sample Library" else "Sign Out")
            }
            Text("Signing out ends this TV's Immich session. An admin can also unlink it from accounts.davideghiotto.it.",
                style = Type.caption)
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 12.dp)) {
        Text(label, style = Type.body, modifier = Modifier.weight(1f))
        Text(value, style = Type.body.copy(color = C.label2))
    }
}

@Composable
private fun Divider() {
    Box(Modifier.fillMaxWidth().padding(start = 18.dp).height(0.5.dp).background(C.separator))
}
