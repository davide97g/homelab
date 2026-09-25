package it.davideghiotto.cinema.design

/**
 * Cinema — a Findroid fork.
 *
 * This file is Cinema's, not upstream's: it names the Reel palette in the vocabulary the app's
 * composables use, so a composable never reaches for a raw token and a palette change never means
 * editing a composable.
 *
 * The values come from CinemaTokens.kt, which is generated from packages/design-tokens/tokens.json
 * in the Cinema monorepo and copied in by apps/android/sync-tokens.sh. Do not hand-edit either.
 *
 * Deliberately a plain object rather than a CompositionLocal: the palette is a compile-time
 * constant with no light variant, and Findroid already provides LocalSpacings.
 */
object CinemaColors {

    /** The single action colour: play, active nav marker, progress. */
    val primary = CinemaTokens.primary

    /** Text and glyphs on [primary]. */
    val onPrimary = CinemaTokens.primaryForeground

    /** The page. Near-black, very slightly cool. */
    val canvas = CinemaTokens.canvas

    /** Cards, inputs and anything sitting on the canvas. */
    val surface = CinemaTokens.surface

    /** Raised: selected rows, hover and focus states. */
    val surfaceRaised = CinemaTokens.surface2

    /** Pressed. */
    val surfacePressed = CinemaTokens.surface3

    /** A border that is meant to be seen -- a focus ring, mostly. */
    val outline = CinemaTokens.surface3

    /** The one hairline in the system, for where two dark surfaces touch. */
    val hairline = CinemaTokens.border

    /** Primary text. */
    val foreground = CinemaTokens.foreground

    /** Metadata, secondary labels, fact lines, inactive controls. */
    val mutedForeground = CinemaTokens.mutedForeground

    /** The one positive signal, used for the community rating and nothing else. */
    val match = CinemaTokens.match

    /** Status flags: new, popular, unreachable storage. */
    val amber = CinemaTokens.amber

    /** Destructive actions and failures. */
    val danger = CinemaTokens.danger
}
