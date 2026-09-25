package dev.jdtech.jellyfin.presentation.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.tv.material3.Shapes as ShapesTv
import it.davideghiotto.cinema.design.CinemaTokens

// Cinema: radii come from tokens.json like every other value.
val shapes =
    Shapes(
        extraSmall = RoundedCornerShape(CinemaTokens.Radius.lg),
        small = RoundedCornerShape(CinemaTokens.Radius.lg),
    )

val shapesTv = ShapesTv(extraSmall = shapes.extraSmall, small = shapes.small)
