# Cinema for Android

A fork of [Findroid](https://github.com/jarnedemeulemeester/findroid) reskinned to Reel,
**vendored** into this repository at `apps/android/findroid`. It is ordinary source in the
monorepo: no submodule, no second remote, no separate history.

**Forked from upstream at `v1.1.0-42-g8f713da4`.** That is the base any future upstream update has
to be worked out against — write the new base here when you do one.

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
bun run tokens                         # palette -> :core, Kotlin and XML

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

`bun run tokens` writes `core/src/main/java/it/davideghiotto/cinema/design/CinemaTokens.kt` and
`core/src/main/res/values/cinema_tokens.xml` straight from `packages/design-tokens/tokens.json`.
Two files because Findroid is not all Compose: the ExoPlayer control layouts and
`core/res/values/themes.xml` are Views resolving `?attr/colorPrimary`, and the launcher and TV
banner backgrounds are `@color` resources. `:core` is the destination because both `:app:phone` and
`:app:tv` depend on it. Never hand-edit a generated file.

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

Five commits' worth of change on top of upstream, deliberately small and mechanical. There is no
`git merge upstream/main` any more — the fork is vendored — so an upstream fix is a manual job
(`git clone --depth 50 https://github.com/jarnedemeulemeester/findroid.git /tmp/findroid`, then
`diff -ru --exclude .git /tmp/findroid apps/android/findroid`), and a small diff is what keeps that
possible. `CINEMA.md` at the fork root has the detail. In short: the Reel palette wired into both app modules' Material 3 schemes, dark
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

## On the TV

The living-room set is a Philips 65PUS8505 at `192.168.15.106`: Android 12 (SDK 31), 2 GB RAM,
**32-bit userspace** — it needs the `armeabi-v7a` split, not `arm64-v8a`.

```sh
apps/android/scripts/tv.sh                     # build debug, install, launch, follow logcat
apps/android/scripts/tv.sh deploy --no-build   # reinstall the last APK
apps/android/scripts/tv.sh logs                # live logcat, follows the app across restarts
apps/android/scripts/tv.sh logs --file         # the on-device log, readable after the fact
apps/android/scripts/tv.sh logs --pull         # copy cinema.log(.1) into ./tv-logs/
TV=emulator-5554 apps/android/scripts/tv.sh    # Android TV AVD (arm64-v8a)
```

It installs the **debug** build (`it.davideghiotto.cinema.debug`): it sits beside a release one,
and being debuggable is what lets `run-as` read the log file back. Upstream's TV app never planted
a Timber tree, so every log line was silent; `it.davideghiotto.cinema.log.FileLogTree` now plants
logcat + a 2 MB rotated file (`files/logs/cinema.log`) and records uncaught exceptions to it before
the process dies. The first line says version, model, SDK and ABI.

**HDR plays as server tone-mapped SDR.** The set switches to "Segnale HDR" for a direct-played
HDR10 file and still shows it grey and washed out. So `PlaylistManager` asks
`getSdrTranscode()` for any remote source whose video range is not SDR: a PlaybackInfo with a
profile that accepts only `VideoRangeType=SDR`, which makes Jellyfin transcode to HLS with
`hevc-rangetype=SDR` and tone-map (`tonemap_opencl`, bt2390) on the NAS. Embedded text subtitles
come back as External delivery URLs; the stream carries one audio track (the user's default). The
switch is `pref_player_hdr_to_sdr`, default on, with no UI yet.

**Discover is a TV tab.** `it.davideghiotto.cinema.discover` browses and requests titles from
Seerr through accounts' `/api/discover`, authenticated by the Jellyfin token the app already holds
(`JellyfinApi.api.accessToken`); the accounts base URL is `AccountsClient.BASE_URL`, so
`-PaccountsUrl` points it at a local accounts too. The tab is appended after Libraries so
upstream's tab indexes stay put. Testing it on the `cinema-tv` AVD: start the emulator with
`-dns-server 1.1.1.1`, or adding the server after sign-in times out.

**Audio and subtitle buttons work on TV.** Upstream left both player buttons as commented-out
stubs (they navigated with compose-destinations, since removed). `PlayerScreen` now opens
`VideoPlayerTrackSelectorDialog` in a `Dialog` and applies a `TrackSelectionOverride` itself.

**The set runs the release build too.** The JARVIS dock opens `it.davideghiotto.cinema`, the
release one, so a fix installed only as debug never reaches what gets watched. Ship both:
`./gradlew :app:tv:assembleLibreRelease` is signed with this Mac's debug key, so
`adb install -r app/tv/build/outputs/apk/libre/release/tv-libre-armeabi-v7a-release.apk` upgrades
it in place.

An agent shell has no Local Network permission either; it can still deploy by writing a
`.command` file that runs `tv.sh deploy --no-build --no-logs` and `open -a Terminal` on it.

Getting ADB onto the set at all (network debugging resets on reboot, the Local Network permission
trap with adb servers started from Orca) is written up in
`~/personal/projects/cassette/apps/tv/README.md`, "Getting ADB onto the TV".

## Distribution

- **Sideload** — build a release APK, no program needed.
- **Play internal / closed testing** — needs the developer account; fastest way onto phones that
  are not yours.
- Android TV is a separate entry point (`:app:tv`) and is skinned too.
