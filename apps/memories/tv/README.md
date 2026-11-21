# Memories for TV

The NAS's Immich on the living-room TV: Library, Collections, Search, the viewer, memories and
slideshows, driven by the remote. Native Kotlin (Compose for TV, Media3, Coil), the iOS app's
look ([`../DESIGN.md`](../DESIGN.md)) adapted to a 10-foot screen. Built the way Cassette's TV app
is (`~/personal/projects/cassette/apps/tv`) for the same Philips 65PUS8505 (Android 12, MT5887,
2 GB, 32-bit userspace). Sideloaded, debug-signed, never published.

## Sign-in: a code, approved on the iPhone

No passwords on a remote. The TV asks accounts for a device code (`client_id: memories-tv`,
already allowed in `apps/accounts/server/src/auth.ts`) and shows it with a QR:

```
TV  POST /api/auth/device/code            -> user_code + QR https://accounts.davideghiotto.it/memories/device?user_code=…
iPhone  QR opens Memories (universal link) -> "Approve this TV" sheet (DeviceApprovalView)
TV  POST /api/auth/device/token (poll)    -> accounts session
TV  POST /api/apps/memories/token         -> this TV's own Immich token + serverUrl
TV  GET  <serverUrl>/.well-known/immich   -> /api, stored with the token
```

Without the app the QR is the web approval page; `accounts.davideghiotto.it/device` + the code
works too. The TV keeps only the Immich token (`Authorization: Bearer`), so it keeps working when
accounts is down. Unlinking the device in accounts revokes it; a 401 sends the TV back to the code.
*Explore Sample Library* on the sign-in screen opens the generated library.

## What it does

| | |
|---|---|
| **Library** | Years · Months · All, as on iOS. All is a month-headed grid, newest first (a remote scrolls down), months loading as they come near; the header shows the focused photo's month and place. 4/6/8 columns. |
| **Viewer** | ←/→ page, OK shows the controls (date capsule, filmstrip, Slideshow, Favorite, Info), ↑ Info sheet on the right, Back steps out. Videos play on arrival (Media3, `/assets/{id}/video/playback`), ⏩/⏪ seek 10 s. Live photos: *Live* plays the motion. Grid thumbnail first, preview on top, neighbours prefetched. |
| **Slideshow** | From the viewer or any album/person/result: crossfade + Ken Burns, 5 s a photo, videos play through. Play/Pause key toggles. |
| **Collections** | Memories (3:4 cards → full-screen player with segment bars), Pinned (Favorites, Recently Saved, Videos), Albums, People & Pets, Places, each row ending in *See All*. |
| **Search** | Immich smart (CLIP) search: a glass field (OK opens the TV keyboard) and suggestion chips. |
| **Settings** | Account, server, version, clear image cache, sign out. |

What it leaves out: editing, deleting, uploading, albums management. That is the phone's job.

## Code

```
MemoriesApp.kt   OkHttp (adds the token to Immich URLs, so Coil and Media3 need nothing), Coil loader, session
Prefs.kt         API base, token, device id
net/             Accounts (device flow + broker), Immich (REST v3.4), Dto (kotlinx.serialization)
data/            Models, MediaService, TimelineStore/ListStore, MockService (+ MockFetcher art), ThumbHash
ui/              Theme (iOS tokens + TV focus), Components, SignIn, Shell, Library, Grid, Viewer, Collections, Search, MemoryPlayer, Settings
```

## Build, test, run

JDK 21 and the Android SDK (platform 37, build-tools 37).

```sh
cd apps/memories/tv
JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew :app:testDebugUnitTest   # DTO decoding + ThumbHash vs the reference
JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew :app:assembleRelease
```

Emulator: the AVD `cinema-tv` (1920×1080) matches the set. Sample library and deep links:

```sh
adb shell am start -n it.davideghiotto.memoriestv/.MainActivity --ez mock true \
  [--es tab collections|search] [--es mode years|months] [--ez openViewer true]
```

## Install

From **Terminal.app** (this Mac's Claude/Orca shells have no Local Network permission; the TV
answers `No route to host` there):

```sh
apps/memories/tv/scripts/deploy.sh             # build, install on 192.168.15.106, launch
apps/memories/tv/scripts/deploy.sh --no-build  # install the APK already built
```

ADB on the TV: *Opzioni sviluppatore → Debug USB*, then network debugging (port 5555); both reset
when the TV reboots. Full procedure and traps: Cassette's `apps/tv/README.md`, "Getting ADB onto
the TV".

## Known gaps

- Not yet run against the real library (no credentials here): the sign-in screen talks to the
  live accounts service, everything after it is verified on the sample library and by decoding
  tests on v3.4.0 payload shapes.
- No map for places (no MapKit on Android TV), no LAN URL switching (the NAS is not on the TV's
  LAN; the public URL is used).
