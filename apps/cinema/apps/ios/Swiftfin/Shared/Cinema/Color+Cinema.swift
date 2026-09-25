//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's: it names the Reel palette in the
// vocabulary the app's views use, so a view never reaches for a raw token and
// a palette change never means editing a view.
//
// The values come from CinemaTokens.swift, which is generated from
// packages/design-tokens/tokens.json in the Cinema monorepo and copied in by
// apps/ios/sync-tokens.sh. Do not hand-edit either.
//

import SwiftUI

extension Color {

    /// The single action colour: play, active state, progress.
    static let cinemaPrimary = CinemaTokens.Palette.primary

    /// Text and glyphs on `cinemaPrimary`.
    static let cinemaOnPrimary = CinemaTokens.Palette.primaryForeground

    /// The page. Near-black, very slightly cool.
    static let cinemaCanvas = CinemaTokens.Palette.canvas

    /// Cards, inputs and anything sitting on the canvas.
    static let cinemaSurface = CinemaTokens.Palette.surface

    /// Raised: selected rows, hover and pressed states.
    static let cinemaSurfaceRaised = CinemaTokens.Palette.surface2

    /// Primary text.
    static let cinemaForeground = CinemaTokens.Palette.foreground

    /// Metadata, secondary labels, inactive controls.
    static let cinemaMutedForeground = CinemaTokens.Palette.mutedForeground

    /// The one positive signal, used for the community rating.
    static let cinemaMatch = CinemaTokens.Palette.match

    /// Status flags: new, popular, unreachable storage.
    static let cinemaAmber = CinemaTokens.Palette.amber

    /// Destructive actions and failures.
    static let cinemaDanger = CinemaTokens.Palette.danger
}
