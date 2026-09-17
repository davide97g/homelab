package dev.jdtech.jellyfin.presentation.theme

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.contentColorFor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import dev.jdtech.jellyfin.core.presentation.theme.Spacings

/**
 * Cinema is dark-only: Reel has no light values, and following the system or the wallpaper renders
 * black type on a white page. `dynamicColor` defaulted to true, so on Android 12+ Material You
 * would have replaced the whole palette.
 *
 * Both parameters are kept and ignored so that every caller and every @Preview upstream writes
 * keeps compiling, and merges stay mechanical.
 */
@Composable
fun FindroidTheme(
    @Suppress("UNUSED_PARAMETER") darkTheme: Boolean? = true,
    @Suppress("UNUSED_PARAMETER") dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    MaterialTheme(colorScheme = darkScheme, shapes = shapes) {
        CompositionLocalProvider(
            LocalContentColor provides contentColorFor(MaterialTheme.colorScheme.background),
            LocalSpacings provides Spacings,
        ) {
            content()
        }
    }
}
