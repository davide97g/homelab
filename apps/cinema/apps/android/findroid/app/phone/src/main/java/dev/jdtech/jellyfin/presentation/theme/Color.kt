package dev.jdtech.jellyfin.presentation.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color
import dev.jdtech.jellyfin.core.presentation.theme.ColorLight
import it.davideghiotto.cinema.design.CinemaColors

val lightScheme =
    lightColorScheme(
        primary = ColorLight.primaryLight,
        onPrimary = ColorLight.onPrimaryLight,
        primaryContainer = ColorLight.primaryContainerLight,
        onPrimaryContainer = ColorLight.onPrimaryContainerLight,
        secondary = ColorLight.secondaryLight,
        onSecondary = ColorLight.onSecondaryLight,
        secondaryContainer = ColorLight.secondaryContainerLight,
        onSecondaryContainer = ColorLight.onSecondaryContainerLight,
        tertiary = ColorLight.tertiaryLight,
        onTertiary = ColorLight.onTertiaryLight,
        tertiaryContainer = ColorLight.tertiaryContainerLight,
        onTertiaryContainer = ColorLight.onTertiaryContainerLight,
        error = ColorLight.errorLight,
        onError = ColorLight.onErrorLight,
        errorContainer = ColorLight.errorContainerLight,
        onErrorContainer = ColorLight.onErrorContainerLight,
        background = ColorLight.backgroundLight,
        onBackground = ColorLight.onBackgroundLight,
        surface = ColorLight.surfaceLight,
        onSurface = ColorLight.onSurfaceLight,
        surfaceVariant = ColorLight.surfaceVariantLight,
        onSurfaceVariant = ColorLight.onSurfaceVariantLight,
        outline = ColorLight.outlineLight,
        outlineVariant = ColorLight.outlineVariantLight,
        scrim = ColorLight.scrimLight,
        inverseSurface = ColorLight.inverseSurfaceLight,
        inverseOnSurface = ColorLight.inverseOnSurfaceLight,
        inversePrimary = ColorLight.inversePrimaryLight,
        surfaceDim = ColorLight.surfaceDimLight,
        surfaceBright = ColorLight.surfaceBrightLight,
        surfaceContainerLowest = ColorLight.surfaceContainerLowestLight,
        surfaceContainerLow = ColorLight.surfaceContainerLowLight,
        surfaceContainer = ColorLight.surfaceContainerLight,
        surfaceContainerHigh = ColorLight.surfaceContainerHighLight,
        surfaceContainerHighest = ColorLight.surfaceContainerHighestLight,
    )

// Cinema: Reel has twelve colours and Material 3 has thirty-five roles, so every
// secondary accent collapses onto the neutral ladder -- Reel's third rule is that
// red is Play, the active nav marker and progress, and nothing else -- and every
// container role is a step on canvas -> surface -> surface2 -> surface3.
//
// Note `surface` is Reel's *canvas*, not Reel's `surface`: M3's `surface` is what
// Scaffold and every bare Surface paint, while Reel's `surface` means a card
// sitting on the canvas. That one goes to `surfaceContainer`.
//
// ColorDark is left untouched in :core, and `lightScheme` above is left in place
// and simply becomes unreachable, so merges from upstream stay mechanical.
val darkScheme =
    darkColorScheme(
        primary = CinemaColors.primary,
        onPrimary = CinemaColors.onPrimary,
        // Neutral on purpose: M3 routes filled-tonal buttons and selected chips
        // through primaryContainer, and a red one would put red on every tonal
        // button in Settings.
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
        // M3 applies its own 32% alpha to this role, so it wants a flat black
        // rather than Reel's already-translucent scrim.
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
