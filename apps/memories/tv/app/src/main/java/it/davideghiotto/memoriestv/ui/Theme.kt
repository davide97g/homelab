package it.davideghiotto.memoriestv.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.darkColorScheme

/**
 * Tokens from apps/memories/DESIGN.md (iOS 26 Photos, dark), the same values the iOS app uses.
 * The TV adds one thing iOS never needed: focus. A focused tile lifts and gets a white ring; a
 * focused glass button turns white with dark text, like tvOS.
 */
object C {
    val black = Color(0xFF000000)
    /** `card` dark. */
    val card = Color(0xFF1C1C1E)
    val raised = Color(0xFF2C2C2E)
    val label = Color(0xFFFFFFFF)
    /** `label-2`: #EBEBF5 at 60%. */
    val label2 = Color(0x99EBEBF5)
    val label3 = Color(0x4DEBEBF5)
    val separator = Color(0x99545458)
    /** System blue, dark. */
    val accent = Color(0xFF0A84FF)
    /** `ThumbnailPlaceholderColor` dark (REA). */
    val placeholder = Color(0xFF333333)
    /** Glass: rgba(30,30,30,.55) with a 0.5 px white hairline at 25%. */
    val glass = Color(0x8C1E1E1E)
    val glassStrong = Color(0xD91E1E1E)
    val hairline = Color(0x40FFFFFF)
    val red = Color(0xFFFF453A)
}

/** Radii from the spec, in TV dp. */
object R {
    val card = 16.dp
    val cover = 10.dp
    val cell = 6.dp
}

object Type {
    /** Large title: 34 pt bold on iPhone; the TV canvas is 960 dp wide, so 30. */
    val largeTitle = TextStyle(fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.3.sp, color = C.label)
    val title = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.Bold, color = C.label)
    val headline = TextStyle(fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = C.label)
    val body = TextStyle(fontSize = 15.sp, color = C.label)
    val subhead = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium, color = C.label2)
    val caption = TextStyle(fontSize = 11.sp, color = C.label2)
}

@Composable
fun MemoriesTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = C.accent,
            onPrimary = C.label,
            background = C.black,
            onBackground = C.label,
            surface = C.card,
            onSurface = C.label,
            surfaceVariant = C.raised,
            onSurfaceVariant = C.label2,
            border = C.hairline,
            error = C.red,
        ),
        content = content,
    )
}
