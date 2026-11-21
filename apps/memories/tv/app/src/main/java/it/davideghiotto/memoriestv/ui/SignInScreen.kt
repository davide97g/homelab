package it.davideghiotto.memoriestv.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Text
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import it.davideghiotto.memoriestv.MemoriesApp
import it.davideghiotto.memoriestv.R as Res
import it.davideghiotto.memoriestv.net.Accounts
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

private sealed interface SignInPhase {
    data object Starting : SignInPhase
    data class Waiting(val userCode: String, val url: String) : SignInPhase
    data object SigningIn : SignInPhase
    data class Failed(val message: String) : SignInPhase
}

/**
 * The TV half of the device sign-in (RFC 8628 through accounts): a code and a QR. The QR opens
 * Memories on the iPhone ("Sign In a TV" sheet); without the app it is the web approval page.
 * A code that expires or is denied is quietly replaced.
 */
@Composable
fun SignInScreen() {
    val app = MemoriesApp.instance
    var phase by remember { mutableStateOf<SignInPhase>(SignInPhase.Starting) }
    var attempt by remember { mutableIntStateOf(0) }

    LaunchedEffect(attempt) {
        phase = SignInPhase.Starting
        try {
            while (true) {
                val code = app.accounts.requestCode()
                phase = SignInPhase.Waiting(code.userCode, app.accounts.approveUrl(code.userCode))
                var interval = code.intervalSeconds.coerceAtLeast(1) * 1000
                val deadline = System.currentTimeMillis() + code.expiresInSeconds * 1000
                var session: String? = null
                while (session == null && System.currentTimeMillis() < deadline) {
                    delay(interval)
                    when (val r = app.accounts.poll(code.deviceCode)) {
                        is Accounts.Poll.Granted -> session = r.sessionToken
                        Accounts.Poll.Pending -> Unit
                        Accounts.Poll.SlowDown -> interval += 5000
                        Accounts.Poll.Gone -> break
                    }
                }
                if (session == null) continue
                phase = SignInPhase.SigningIn
                app.signIn(session)
                return@LaunchedEffect
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            phase = SignInPhase.Failed(
                (e as? Accounts.AccountsException)?.message ?: e.message ?: "Can't reach accounts.davideghiotto.it",
            )
        }
    }

    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    Box(
        Modifier.fillMaxSize().background(
            Brush.radialGradient(listOf(Color(0xFF1B2A4A), C.black), center = Offset(200f, 120f), radius = 1600f),
        ),
    ) {
        Row(
            Modifier.fillMaxSize().padding(horizontal = 72.dp, vertical = 48.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(72.dp, Alignment.CenterHorizontally),
        ) {
            Column(Modifier.width(440.dp)) {
                Image(painterResource(Res.drawable.icon), null, Modifier.size(64.dp))
                Spacer(Modifier.height(20.dp))
                Text("Sign In to Memories", style = Type.largeTitle)
                Spacer(Modifier.height(14.dp))
                Text("Scan the code with your iPhone: Memories opens and asks to approve this TV.",
                    style = Type.body.copy(color = C.label2, fontSize = 16.sp))
                Spacer(Modifier.height(10.dp))
                Text("Or open accounts.davideghiotto.it/device and enter",
                    style = Type.body.copy(color = C.label2, fontSize = 16.sp))
                Spacer(Modifier.height(14.dp))
                val code = (phase as? SignInPhase.Waiting)?.userCode
                Text(
                    code?.chunked(4)?.joinToString("-") ?: "····-····",
                    fontFamily = FontFamily.Monospace, fontSize = 48.sp, fontWeight = FontWeight.SemiBold,
                    letterSpacing = 4.sp, color = C.label,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    when (val p = phase) {
                        SignInPhase.Starting -> "Getting a code…"
                        is SignInPhase.Waiting -> "Waiting for your iPhone…"
                        SignInPhase.SigningIn -> "Approved. Signing in…"
                        is SignInPhase.Failed -> p.message
                    },
                    style = Type.subhead.copy(color = if (phase is SignInPhase.Failed) C.red else C.label2),
                )
                Spacer(Modifier.height(28.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (phase is SignInPhase.Failed) {
                        GlassButton(onClick = { attempt++ }, label = "Try Again")
                    }
                    GlassButton(onClick = { app.startDemo() }, label = "Explore Sample Library",
                        modifier = Modifier.focusRequester(focus))
                }
            }
            Box(
                Modifier.size(300.dp).background(Color.White, RoundedCornerShape(R.card)).padding(22.dp),
                contentAlignment = Alignment.Center,
            ) {
                (phase as? SignInPhase.Waiting)?.let { QrCode(it.url, Modifier.fillMaxSize()) }
            }
        }
    }
}

@Composable
private fun QrCode(text: String, modifier: Modifier = Modifier) {
    val matrix = remember(text) {
        QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 0))
    }
    Canvas(modifier) {
        val cell = size.minDimension / matrix.width
        val left = (size.width - cell * matrix.width) / 2
        val top = (size.height - cell * matrix.height) / 2
        for (y in 0 until matrix.height) for (x in 0 until matrix.width) {
            if (matrix[x, y]) drawRect(Color.Black, Offset(left + x * cell, top + y * cell), Size(cell + 0.5f, cell + 0.5f))
        }
    }
}
