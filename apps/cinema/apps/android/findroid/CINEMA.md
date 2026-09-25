# Cinema for Android

This is a fork of [Findroid](https://github.com/jarnedemeulemeester/findroid), a third-party
native Jellyfin client, reskinned as **Cinema** — a personal front end for one Jellyfin server.

Upstream does the hard parts: the Jellyfin API layer, Media3/ExoPlayer playback with transcode
negotiation, offline downloads, Android TV. This fork changes the surface.

## Licence

Findroid is **GPLv3**, and so is this fork. That means, concretely:

- The whole work is GPLv3, including the files Cinema adds. There is no file-scoped escape here
  the way there is under MPL: everything in this repository is published under GPLv3.
- Distributing a build means publishing this source. It is, here.
- Google Play is fine with that. The App Store is not — Apple's terms impose restrictions GPLv3
  forbids, which is why Cinema forks Swiftfin (MPL-2.0) on iOS instead.

Upstream's `LICENSE` and attribution stay exactly as they are.

**Never copy code from this repository into Cinema's iOS app.** That one is a Swiftfin fork under
MPL-2.0, and GPLv3 code entering it would relicense it and make it unshippable on the App Store.
Shared logic goes in the monorepo's `packages/`, written by us, or it gets written twice.

## The palette

`core/src/main/java/it/davideghiotto/cinema/design/CinemaTokens.kt` and
`core/src/main/res/values/cinema_tokens.xml` are **generated**. Their source of truth is
`packages/design-tokens/tokens.json` at the root of this repository, which also generates the web
app's CSS variables and the iOS app's Swift palette — one palette, three clients, no drift.

Two files because Findroid is not all Compose: `core/res/values/themes.xml` and the ExoPlayer
control layouts in `app/phone/res/layout` are real Views resolving `?attr/colorPrimary` and
`?attr/colorSurface`, and the launcher and TV banner backgrounds are `@color` resources.

To change a colour: edit `tokens.json` at the repo root, then

```sh
bun run tokens   # regenerate for all three platforms, straight into each app
```

and commit the result as an ordinary change. Never hand-edit a generated file.

`CinemaColors.kt` beside them names those tokens in the vocabulary composables use
(`CinemaColors.primary`, `CinemaColors.surfaceRaised`, …). Composables reference the names, never
the tokens, so the palette can move without touching a composable.

The Material 3 colour schemes are built from those names in
`app/phone/src/main/java/dev/jdtech/jellyfin/presentation/theme/Color.kt` and its `app/tv` twin.
Reel has twelve colours and Material 3 has thirty-five roles, so every secondary accent collapses
onto the neutral ladder and every container role is a step on canvas → surface → surface2 →
surface3. The one thing to remember: **M3 `surface` is Reel's `canvas`**, and Reel's `surface`
token is M3's `surfaceContainer`.

## Dark only

Reel has no light values. Four things had to change, because Android decides appearance in four
places:

1. `app/phone/.../presentation/theme/Theme.kt` — `dynamicColor` defaulted to `true`, so on
   Android 12+ Material You would have replaced the whole palette with the wallpaper's.
2. `settings/.../domain/AppPreferences.kt` — the stored `pref_theme` and `pref_dynamic_colors`
   defaults.
3. `app/phone/.../BaseApplication.kt` — `AppCompatDelegate.MODE_NIGHT_YES` unconditionally, and
   no `DynamicColors.applyToActivitiesIfAvailable`. This is the View half: the player's controls
   are Views, and Compose forcing dark does not reach them.
4. `core/res/values/themes.xml` — parented on `Theme.Material3.Dark`, not `.DayNight`. This is
   the window background behind Compose and the system bars.

## The mark

The launcher icon and the TV banner are vector drawables of Lucide's `film` glyph on a 24-unit
grid — the same shape the web app's rail draws — filled from `@color/cinema_*`, so they cannot
drift from the palette. The Play Store's 512×512 raster is rendered from the same geometry and
the same tokens by `apps/android/make-app-icon.sh` in the monorepo.

## Keeping up with upstream

```sh
git fetch upstream
git merge upstream/main
```

The fork deliberately keeps its diff small and mechanical, so this stays cheap:

- `core/.../presentation/theme/Color.kt` still defines `ColorDark` and `ColorLight`. Cinema does
  not delete them; it simply stops applying them, which keeps merges clean.
- The palette is changed where it is *used*, not where it is *declared*.
- `lightScheme` in `app/phone`'s theme is left in place and simply becomes unreachable.
- Upstream's `HomeCarousel` and `HomeCarouselItem` are left compiled but unused rather than
  deleted, for the same reason.
- Everything Cinema adds lives under a top-level `it/` source directory that upstream never
  touches, so it cannot conflict.

## Building

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"

./gradlew :app:phone:assembleLibreDebug
./gradlew :app:tv:assembleLibreDebug
./gradlew ktfmtCheck          # wired to `check`, not `assemble` -- run it before pushing
```

`libre` is the only product flavour and is the default, so `assembleDebug` works too, but the
output paths carry the flavour and the ABI split:
`app/phone/build/outputs/apk/libre/debug/phone-libre-arm64-v8a-debug.apk`. There is no universal
APK — `./gradlew :app:phone:installLibreDebug` picks the right split for the connected device.
