# Cinema for Android

A fork of [Findroid](https://github.com/jarnedemeulemeester/findroid) reskinned to Reel, attached
here as a git submodule at `apps/android/findroid` and tracked at
[davide97g/findroid](https://github.com/davide97g/findroid) on the `cinema` branch.

## Why a fork and not a wrapper

Findroid is native Kotlin + Jetpack Compose on Media3/ExoPlayer, against the same Jellyfin API
`apps/web` uses. Playback, downloads and Android TV are already solved; the UI layer is the part
Cinema replaces.

**Licence: GPLv3.** Whole-work copyleft: distributing a build means publishing this fork's source,
which is why it is public. Google Play is fine with that. The App Store is not, which is why iOS
forks Swiftfin (MPL-2.0) instead. Keep the two apps' lineages straight: never copy GPL code from
here into `apps/ios`. See [`../../docs/ARCHITECTURE.md` § 6](../../docs/ARCHITECTURE.md).

## Working on it

```sh
git submodule update --init            # after a fresh clone of the monorepo
bun run tokens                         # palette -> generated/ -> the fork

export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"

cd apps/android/findroid
./gradlew :app:phone:installLibreDebug
./gradlew :app:tv:installLibreDebug
./gradlew ktfmtCheck                   # wired to `check`, not `assemble`
```

Findroid needs **JDK 21**, `platforms;android-37.0` and `build-tools;37.0.0`. Note the SDK id is
`android-37.0`, with a minor version — there is no `platforms;android-37`, and the packages only
appear in `repository2-3.xml`, so `cmdline-tools` must be rev 23 or newer or they look missing.

`libre` is the only product flavour and is the default. ABI splits are on, so there is no
universal APK: use `installLibreDebug`, or the
`app/phone/build/outputs/apk/libre/debug/phone-libre-arm64-v8a-debug.apk` split.

## The palette

`generated/CinemaTokens.kt` and `generated/cinema_tokens.xml` are emitted from
`packages/design-tokens/tokens.json` by `bun run tokens`, which then runs `sync-tokens.sh` to copy
them into the fork's `:core` module. Two files because Findroid is not all Compose: the ExoPlayer
control layouts and `core/res/values/themes.xml` are Views resolving `?attr/colorPrimary`, and the
launcher and TV banner backgrounds are `@color` resources.

`CinemaColors.kt`, beside them in the fork, names those tokens the way composables speak:
`CinemaColors.primary`, `CinemaColors.surfaceRaised`, `CinemaColors.match`. Composables use the
names. Never hand-edit a generated file.

## The app icon

```sh
apps/android/make-app-icon.sh
```

Renders the Play Store's 512×512 raster from Reel's canvas and action colour and the same Lucide
`film` glyph the launcher icon, the TV banner, the in-app mark and the web rail all draw. Both
colours are read from `tokens.json`, so the icon cannot drift from the palette. The launcher and
banner themselves are vector drawables referencing `@color/cinema_*` and need no build step.

## What the fork changes

Five commits on top of upstream, deliberately small and mechanical so `git merge upstream/main`
stays cheap — that is where server-compatibility fixes come from. `CINEMA.md` at the fork root has
the detail. In short: the Reel palette wired into both app modules' Material 3 schemes, dark
forced in the four places Android decides it, the feature band on both home screens, and the
identity (application id `it.davideghiotto.cinema`, name Cinema, the mark).

## Toolchain and emulator notes

- The SDK package id is `platforms;android-37.0`, **with a minor version** — there is no
  `platforms;android-37`, and these packages only appear in `repository2-3.xml`, so `cmdline-tools`
  must be rev 23+ or they look like they do not exist. Updating `cmdline-tools` installs beside the
  old one as `latest-2`; it has to be moved into place by hand.
- Apple Silicon needs `arm64-v8a` system images; an `x86_64` image is full CPU emulation and useless
  for a video client. Android TV tops out at **API 36** — there is no API-37 TV image in any ABI,
  which is fine, `targetSdk` is 36.
- `ktfmtCheck` hangs off `check`, not `assemble`, so a build will not catch a badly formatted file.
  The Kotlin token emitter in `packages/design-tokens/build.ts` writes 4-space indentation for
  exactly this reason.
- Driving the TV emulator: `adb shell input keyevent 61` (TAB) traverses focus; DPAD_DOWN does not
  move focus out of a text field, and `adb shell input tap` does nothing on a TV AVD.

## Distribution

- **Sideload** — build a release APK, no program needed.
- **Play internal / closed testing** — needs the developer account; fastest way onto phones that
  are not yours.
- Android TV is a separate entry point (`:app:tv`) and is skinned too.
