package it.davideghiotto.memoriestv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import it.davideghiotto.memoriestv.ui.C
import it.davideghiotto.memoriestv.ui.MemoriesTheme
import it.davideghiotto.memoriestv.ui.Shell
import it.davideghiotto.memoriestv.ui.SignInScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = MemoriesApp.instance
        // `adb shell am start -n it.davideghiotto.memoriestv/.MainActivity --ez mock true`
        app.boot(mock = intent.getBooleanExtra("mock", false))
        setContent {
            MemoriesTheme {
                val service by app.service.collectAsState()
                Box(Modifier.fillMaxSize().background(C.black)) {
                    val s = service
                    if (s == null) {
                        SignInScreen()
                    } else {
                        // A new session (sign-in, sample library) starts from a fresh shell.
                        key(s) { Shell(launch = LaunchOptions.from(intent)) }
                    }
                }
            }
        }
    }
}

/** Deep-link extras for screenshots, mirroring the iOS launch arguments. */
data class LaunchOptions(val tab: String?, val openViewer: Boolean, val mode: String?) {
    companion object {
        fun from(intent: android.content.Intent) = LaunchOptions(
            tab = intent.getStringExtra("tab"),
            openViewer = intent.getBooleanExtra("openViewer", false),
            mode = intent.getStringExtra("mode"),
        )
    }
}
