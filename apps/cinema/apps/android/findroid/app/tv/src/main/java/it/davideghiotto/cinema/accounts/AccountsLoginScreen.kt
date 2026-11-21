package it.davideghiotto.cinema.accounts

import androidx.compose.foundation.Canvas
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
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.tv.material3.Button
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.OutlinedButton
import androidx.tv.material3.Text
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import dev.jdtech.jellyfin.utils.ObserveAsEvents

/**
 * The first screen on a TV that is not signed in: a code to type on the phone, or a QR that opens
 * the Cinema app (or the web page) to approve this TV. The old Jellyfin server/user/password path
 * stays one button away.
 */
@Composable
fun AccountsLoginScreen(
    onSuccess: () -> Unit,
    onOtherWaysClick: () -> Unit,
    viewModel: AccountsLoginViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    DisposableEffect(Unit) {
        viewModel.start()
        onDispose { viewModel.stop() }
    }
    ObserveAsEvents(viewModel.success) { onSuccess() }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(64.dp, Alignment.CenterHorizontally),
        modifier = Modifier.fillMaxSize().padding(48.dp),
    ) {
        Column(modifier = Modifier.width(480.dp)) {
            Text(text = "Sign in to Cinema", style = MaterialTheme.typography.displaySmall)
            Spacer(Modifier.height(24.dp))
            Text(
                text = "Scan the code with your phone, or open",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = "accounts.davideghiotto.it/device",
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = "and enter",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                text = state.userCode?.let { it.chunked(4).joinToString("-") } ?: "····-····",
                fontFamily = FontFamily.Monospace,
                fontSize = 56.sp,
                letterSpacing = 4.sp,
                style = MaterialTheme.typography.displayMedium,
            )
            Spacer(Modifier.height(16.dp))
            Text(
                text =
                    when (state.phase) {
                        AccountsLoginState.Phase.Starting -> "Getting a code…"
                        AccountsLoginState.Phase.Waiting -> "Waiting for your phone…"
                        AccountsLoginState.Phase.SigningIn -> "Approved. Signing in…"
                        AccountsLoginState.Phase.Failed -> state.error ?: "Sign-in failed"
                    },
                style = MaterialTheme.typography.bodyLarge,
                color =
                    if (state.phase == AccountsLoginState.Phase.Failed)
                        MaterialTheme.colorScheme.error
                    else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(32.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                if (state.phase == AccountsLoginState.Phase.Failed) {
                    Button(onClick = { viewModel.start() }) { Text("Try again") }
                }
                OutlinedButton(
                    onClick = onOtherWaysClick,
                    modifier = Modifier.focusRequester(focus),
                ) {
                    Text("Jellyfin server sign-in")
                }
            }
        }
        Box(
            contentAlignment = Alignment.Center,
            modifier =
                Modifier.size(300.dp)
                    .background(Color.White, RoundedCornerShape(16.dp))
                    .padding(20.dp),
        ) {
            state.approveUrl?.let { QrCode(it, Modifier.fillMaxSize()) }
        }
    }
}

@Composable
private fun QrCode(text: String, modifier: Modifier = Modifier) {
    val matrix: BitMatrix =
        remember(text) {
            QRCodeWriter()
                .encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 0))
        }
    Canvas(modifier = modifier) {
        val cell = size.minDimension / matrix.width
        val left = (size.width - cell * matrix.width) / 2
        val top = (size.height - cell * matrix.height) / 2
        for (y in 0 until matrix.height) {
            for (x in 0 until matrix.width) {
                if (matrix[x, y]) {
                    drawRect(
                        color = Color.Black,
                        topLeft = Offset(left + x * cell, top + y * cell),
                        size = Size(cell + 0.5f, cell + 0.5f),
                    )
                }
            }
        }
    }
}
