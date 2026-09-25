//
// Cinema — a Swiftfin fork.
//
// This file is Cinema's, not upstream's.
//
// The app's own name and its own links. Upstream keeps saying "Swiftfin" in a
// handful of places; the ones that are user-facing read from here instead, so
// the rename is one file rather than a scattering of literals.
//

import Foundation

extension L10n {

    /// The product name. Not localised: it is a proper noun, like upstream's.
    static let cinema = "Cinema"

    /// Shown in About, under upstream's licence, because MPL-2.0 asks that the
    /// work this is built on stays credited.
    static let basedOnSwiftfin = "Based on Swiftfin"
}

extension URL {

    /// The monorepo, which is where this fork now lives and what the About
    /// screen points at — the modified MPL files are under apps/ios/Swiftfin,
    /// and publishing them is what the licence requires.
    ///
    /// The repository is public, which is what publishes the modified MPL
    /// files this fork is built from.
    static let cinemaGithub: URL = URL(string: "https://github.com/davide97g/cinema")!

    static let cinemaGithubLicense: URL =
        URL(string: "https://github.com/davide97g/cinema/blob/main/apps/ios/Swiftfin/LICENSE.md")!

    static let cinemaGithubIssues: URL = URL(string: "https://github.com/davide97g/cinema/issues")!
}
