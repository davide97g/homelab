# Cinema for iOS

A fork of [Swiftfin](https://github.com/jellyfin/Swiftfin) reskinned to Nebula.

## Why a fork and not a wrapper

Swiftfin is native SwiftUI against the same Jellyfin API `apps/web` uses, and it already solves
the two things that are miserable to redo: `AVPlayer` playback with Jellyfin's transcode
negotiation, and offline downloads. The UI layer is where Cinema differs, and that is the layer
a fork can own.

**Licence: MPL-2.0.** This matters and is the reason iOS forks Swiftfin rather than Findroid.
MPL is file-scoped copyleft: modified Swiftfin files stay MPL and must be published, new files
can be ours, and App Store distribution is fine. A GPLv3 client cannot ship on the App Store at
all — Apple's terms impose restrictions GPLv3 forbids.

## Bootstrap

```sh
# 1. Fork jellyfin/Swiftfin on GitHub (keep the licence and attribution intact).
# 2. Attach the fork here as a submodule:
./bootstrap.sh git@github.com:<you>/Swiftfin.git
```

The fork lands in `apps/ios/Swiftfin` as a git submodule, so upstream stays mergeable:
`git -C apps/ios/Swiftfin pull upstream main` when Jellyfin ships a server change.

## Applying the design

`generated/CinemaTokens.swift` is emitted from `packages/design-tokens/tokens.json` by
`bun run tokens` at the repo root — the same file the web palette is built from. Copy or
symlink it into the fork's `Shared/` group and replace Swiftfin's colour lookups with
`CinemaTokens.Palette`. Re-run `bun run tokens` after any palette change; never hand-edit the
generated file.

Order of work, cheapest visual delta first:

1. Palette + corner radii (`CinemaTokens`) — the app reads as Cinema immediately.
2. Home: hero pager, "In library" rail, poster cards with chips — mirrors `apps/web`.
3. Navigation chrome: rail on iPad, pill row on iPhone.
4. Player controls last. Swiftfin's are good; restyle, do not rewrite.

## Distribution

Apple Developer Program, no public listing needed:

| Route | Reach | Review | Notes |
|---|---|---|---|
| TestFlight | 10 000 testers | Yes | Builds expire after 90 days |
| Unlisted App Store | Anyone with the link | Yes | Permanent, not searchable |
| Ad Hoc | 100 devices | No | Re-sign yearly |

Review needs a working demo account plus the server URL, since the app is useless without a
Jellyfin behind it. Point it at the tunnel hostname, not a LAN IP.
