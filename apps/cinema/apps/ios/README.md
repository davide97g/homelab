# Cinema for iOS

A fork of [Swiftfin](https://github.com/jellyfin/Swiftfin) reskinned to Reel, attached here as a
git submodule at `apps/ios/Swiftfin` and tracked at
[davide97g/Swiftfin](https://github.com/davide97g/Swiftfin) on the `cinema` branch.

## Why a fork and not a wrapper

Swiftfin is native SwiftUI against the same Jellyfin API `apps/web` uses, and it already solves
the two things that are miserable to redo: `AVPlayer` playback with Jellyfin's transcode
negotiation, and offline downloads. The UI layer is where Cinema differs, and that is the layer
a fork can own.

**Licence: MPL-2.0.** This matters and is the reason iOS forks Swiftfin rather than Findroid.
MPL is file-scoped copyleft: modified Swiftfin files stay MPL and must be published, new files
can be ours, and App Store distribution is fine. A GPLv3 client cannot ship on the App Store at
all — Apple's terms impose restrictions GPLv3 forbids. See [`../../docs/LICENSING.md`](../../docs/LICENSING.md).

## Working on it

```sh
git submodule update --init            # after a fresh clone of the monorepo
bun run tokens && apps/ios/sync-tokens.sh   # palette -> the fork
open apps/ios/Swiftfin/Swiftfin.xcodeproj
```

From the command line:

```sh
cd apps/ios/Swiftfin
xcodebuild -project Swiftfin.xcodeproj -scheme Swiftfin \
  -destination 'generic/platform=iOS Simulator' -skipMacroValidation build
```

`-skipMacroValidation` is not optional here: several dependencies ship Swift macros, and Xcode
refuses to run them from the command line until they have been trusted in the GUI. Without the
flag the build fails with *Macro "CasePathsMacros" … must be enabled before it can be used*.

Signing for a device goes in `apps/ios/Swiftfin/XcodeConfig/DevelopmentTeam.xcconfig`, which the
fork gitignores:

```
DEVELOPMENT_TEAM = YOURTEAMID
```

## The palette

`generated/CinemaTokens.swift` is emitted from `packages/design-tokens/tokens.json` by
`bun run tokens`, and `sync-tokens.sh` copies it into the fork at
`Shared/Cinema/CinemaTokens.swift`. The fork is a separate repository, so the token build does
not write into it directly — the palette lands there as a reviewable commit in the fork's own
history. Never hand-edit a generated file.

`Shared/Cinema/Color+Cinema.swift` names those tokens the way views speak: `.cinemaPrimary`,
`.cinemaSurface`, `.cinemaMatch`. Views use the names.

## Done

1. **Palette and identity.** Tokens in, accent colour repointed at Cinema red, bundle identifier
   `it.davideghiotto.cinema`, display name Cinema.

## Next, cheapest visual delta first

2. **Home.** Feature band (one large paging card plus two beside it), rows with a kind tag, a
   title and a dot-separated fact line. Mirrors `apps/web`; see [`../../docs/DESIGN.md`](../../docs/DESIGN.md).
3. **Navigation chrome.** Rail on iPad, tab row on iPhone.
4. **Strings.** Upstream says "Swiftfin" in user-facing copy in a few places.
5. **App icon.** `Swiftfin/Resources/Assets.xcassets`.
6. **Player last.** Swiftfin's controls are good; restyle, do not rewrite.

Keep the diff against upstream small and mechanical — `git merge upstream/main` has to stay cheap
forever, because that is where server-compatibility fixes come from.

## Distribution

Apple Developer Program, no public listing needed:

| Route | Reach | Review | Notes |
|---|---|---|---|
| TestFlight | 10 000 testers | Yes | Builds expire after 90 days |
| Unlisted App Store | Anyone with the link | Yes | Permanent, not searchable |
| Ad Hoc | 100 devices | No | Re-sign yearly |

Review needs a working demo account plus the server URL, since the app is useless without a
Jellyfin behind it. Point it at the tunnel hostname, not a LAN IP.
