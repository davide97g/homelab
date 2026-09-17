# Cinema for iOS

This is a fork of [Swiftfin](https://github.com/jellyfin/Swiftfin), the native Jellyfin client,
reskinned as **Cinema** — a personal front end for one Jellyfin server.

Upstream does the hard parts: the API layer, `AVPlayer` playback with Jellyfin's transcode
negotiation, offline downloads, tvOS. This fork changes the surface.

## Licence

Swiftfin is **MPL-2.0**, and so is this fork. That means, concretely:

- Every file here that came from upstream stays MPL-2.0. Modified ones must be published — they
  are, in this repository.
- New files added by Cinema (`Shared/Cinema/`) can carry their own terms, and are noted as ours
  in their headers.
- App Store distribution is fine. This is the reason Cinema forks Swiftfin on iOS rather than
  Findroid, which is GPLv3 and cannot ship there.

Upstream's `LICENSE.md` and attribution stay exactly as they are.

**Never copy code into this repository from Cinema's Android app** — that one is a Findroid fork
under GPLv3, and pulling GPL code in here would make this app unshippable on the App Store.

## The palette

`Shared/Cinema/CinemaTokens.swift` is **generated**. Its source of truth is
`packages/design-tokens/tokens.json` at the root of this repository, which also generates the web
app's CSS variables and the Android app's Compose colours — one palette, three clients, no drift.

To change a colour: edit `tokens.json` at the repo root, then

```sh
bun run tokens   # regenerate for all three platforms, straight into each app
```

and commit the result as an ordinary change. Never hand-edit the generated file.

`Shared/Cinema/Color+Cinema.swift` names those tokens in the vocabulary views use
(`.cinemaPrimary`, `.cinemaSurface`, …). Views reference the names, never the tokens, so the
palette can move without touching a view.

## What is Cinema's

Everything under `Shared/Cinema/` is new here, not modified upstream:

| File | Is |
|---|---|
| `CinemaTokens.swift` | The palette. Generated — see above. |
| `Color+Cinema.swift` | Those tokens under the names views use. |
| `CinemaStrings.swift` | The app's own name and its own links. |
| `CinemaMark.swift` | The film glyph and the wordmark, drawn rather than imported. |
| `FeatureCard.swift` | One page of the feature band. |
| `FeatureContentGroup.swift` | The band itself, and the `ContentGroup` that places it. |

The app icon is rendered by `apps/ios/make-app-icon.swift` in the Cinema monorepo, from the same
glyph and the same tokens. Upstream's alternate icons are still in the catalogue, untouched, but
are no longer offered: the Customize section of app settings is gone on iOS, because all of them
are Jellyfin's and the appearance picker under it was dead once Reel forced dark.

Changes to upstream files are kept to what cannot be done from a new file: the accent colour and
the forced dark appearance, the feature band's one line in `DefaultContentGroupProvider`, the
iPad sidebar in `MainTabView`, the scrub bar's colour in `PlaybackProgress`, and the Jellyfin
blob swapped for Cinema's mark in `AboutAppView`, `AppSettingsView`, `SettingsView` and
`SelectUserView`. The English copy in `Translations/en.lproj/Localizable.strings` says Cinema;
`Shared/Strings/Strings.swift` is regenerated from it with
`swift Scripts/Translations/GenerateStrings.swift` and never hand-edited.

## Keeping up with upstream

```sh
git fetch upstream
git merge upstream/main
```

The fork deliberately keeps its diff small and mechanical, so this stays cheap:

- `Shared/Extensions/Color.swift` still defines `jellyfinPurple`. Cinema does not delete it; it
  simply stops applying it, which keeps merges clean.
- The accent colour is changed where it is *used*, not where it is *declared*.

## Building

```sh
xcodebuild -project Swiftfin.xcodeproj -scheme Swiftfin \
  -destination 'generic/platform=iOS Simulator' -skipMacroValidation build
```

`-skipMacroValidation` is required from the command line: several dependencies ship Swift macros,
which Xcode refuses to run until they are trusted in the GUI.

Signing for a device build goes in `XcodeConfig/DevelopmentTeam.xcconfig`, which is gitignored:

```
DEVELOPMENT_TEAM = YOURTEAMID
```
