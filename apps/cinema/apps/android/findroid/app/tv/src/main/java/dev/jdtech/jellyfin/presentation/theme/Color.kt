package dev.jdtech.jellyfin.presentation.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.graphics.Color
import androidx.tv.material3.darkColorScheme as darkColorSchemeTv
import it.davideghiotto.cinema.design.CinemaColors

// Cinema: the same mapping as the phone module, twice, because this module nests
// a Material 3 theme inside a tv-material3 one and half the screens read each.
// See app/phone/.../theme/Color.kt for why the roles land where they do; the one
// thing to know is that M3 `surface` is Reel's *canvas*, and Reel's `surface`
// token is `surfaceContainer`.
//
// ColorDark in :core is left untouched, so merges from upstream stay mechanical.
val darkScheme =
    darkColorScheme(
        primary = CinemaColors.primary,
        onPrimary = CinemaColors.onPrimary,
        primaryContainer = CinemaColors.surfaceRaised,
        onPrimaryContainer = CinemaColors.foreground,
        secondary = CinemaColors.mutedForeground,
        onSecondary = CinemaColors.canvas,
        secondaryContainer = CinemaColors.surfaceRaised,
        onSecondaryContainer = CinemaColors.foreground,
        tertiary = CinemaColors.mutedForeground,
        onTertiary = CinemaColors.canvas,
        tertiaryContainer = CinemaColors.surfaceRaised,
        onTertiaryContainer = CinemaColors.foreground,
        error = CinemaColors.danger,
        onError = CinemaColors.onPrimary,
        errorContainer = CinemaColors.surfaceRaised,
        onErrorContainer = CinemaColors.danger,
        background = CinemaColors.canvas,
        onBackground = CinemaColors.foreground,
        surface = CinemaColors.canvas,
        onSurface = CinemaColors.foreground,
        surfaceVariant = CinemaColors.surfaceRaised,
        onSurfaceVariant = CinemaColors.mutedForeground,
        outline = CinemaColors.outline,
        outlineVariant = CinemaColors.hairline,
        scrim = Color.Black,
        inverseSurface = CinemaColors.foreground,
        inverseOnSurface = CinemaColors.canvas,
        inversePrimary = CinemaColors.primary,
        surfaceDim = CinemaColors.canvas,
        surfaceBright = CinemaColors.outline,
        surfaceContainerLowest = CinemaColors.canvas,
        surfaceContainerLow = CinemaColors.surface,
        surfaceContainer = CinemaColors.surface,
        surfaceContainerHigh = CinemaColors.surfaceRaised,
        surfaceContainerHighest = CinemaColors.outline,
    )

// tv-material3 has its own role set -- no surfaceContainer*, no surfaceDim, and
// border/borderVariant in place of outline. This mirrors upstream's argument list
// exactly and adds nothing to it, so the diff stays mechanical.
val darkSchemeTv =
    darkColorSchemeTv(
        primary = CinemaColors.primary,
        onPrimary = CinemaColors.onPrimary,
        primaryContainer = CinemaColors.surfaceRaised,
        onPrimaryContainer = CinemaColors.foreground,
        secondary = CinemaColors.mutedForeground,
        onSecondary = CinemaColors.canvas,
        secondaryContainer = CinemaColors.surfaceRaised,
        onSecondaryContainer = CinemaColors.foreground,
        tertiary = CinemaColors.mutedForeground,
        onTertiary = CinemaColors.canvas,
        tertiaryContainer = CinemaColors.surfaceRaised,
        onTertiaryContainer = CinemaColors.foreground,
        error = CinemaColors.danger,
        onError = CinemaColors.onPrimary,
        errorContainer = CinemaColors.surfaceRaised,
        onErrorContainer = CinemaColors.danger,
        background = CinemaColors.canvas,
        onBackground = CinemaColors.foreground,
        surface = CinemaColors.canvas,
        onSurface = CinemaColors.foreground,
        surfaceVariant = CinemaColors.surfaceRaised,
        onSurfaceVariant = CinemaColors.mutedForeground,
        scrim = Color.Black,
        inverseSurface = CinemaColors.foreground,
        inverseOnSurface = CinemaColors.canvas,
        inversePrimary = CinemaColors.primary,
    )
