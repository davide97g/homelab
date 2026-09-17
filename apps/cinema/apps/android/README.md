# Cinema for Android

A fork of [Findroid](https://github.com/jarnedemeulemeester/findroid) reskinned to Reel.

## Why a fork and not a wrapper

Findroid is native Kotlin + Jetpack Compose on Media3/ExoPlayer, against the same Jellyfin API
`apps/web` uses. Playback, downloads and Android TV support are already solved; the UI layer is
the part Cinema replaces.

**Licence: GPLv3.** Distributing a build means publishing this fork's source — fine, and fine on
Google Play. It is *not* fine on the App Store, which is why iOS forks Swiftfin (MPL-2.0)
instead. Keep the two apps' lineages straight: never copy GPL code from here into `apps/ios`.

## Bootstrap

```sh
# 1. Fork jarnedemeulemeester/findroid on GitHub (keep LICENSE and attribution).
# 2. Attach the fork here as a submodule:
./bootstrap.sh git@github.com:<you>/findroid.git
```

## Applying the design

`generated/CinemaTokens.kt` is emitted from `packages/design-tokens/tokens.json` by
`bun run tokens` at the repo root. Drop it into the fork's `core/` module under
`it.davideghiotto.cinema.design` and feed it into the Compose `MaterialTheme` colour scheme;
Findroid themes through Material 3, so one `darkColorScheme(...)` built from `CinemaTokens`
converts most screens at once. Never hand-edit the generated file.

Order of work matches iOS: palette and radii, then home (hero pager, library rail, chip cards),
then navigation, then the player.

## Distribution

- **Sideload** — build a release APK, no program needed.
- **Play internal / closed testing** — needs the developer account; fastest way onto phones
  that are not yours.
- Android TV is a separate leanback entry point in Findroid; worth keeping, given
  [`tv/jarvis-tv`](../../../tv) already lives on the same screen.
