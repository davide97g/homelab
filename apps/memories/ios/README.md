# Memories for iOS

Native SwiftUI client for the NAS's Immich (v3.4.0), styled after iOS 26 Photos. Spec and
tokens: [`../DESIGN.md`](../DESIGN.md). API: [`../spec/immich-openapi-v3.4.0.json`](../spec/immich-openapi-v3.4.0.json).

iOS 26+, iPhone. No third-party packages.

## Generate, build, test

```sh
cd apps/memories/ios
xcodegen generate                      # writes Memories.xcodeproj (gitignored) and Memories/Info.plist
xcodebuild -scheme Memories \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build test
```

`project.yml` is the source of truth; never edit the generated project. Re-run `xcodegen generate`
after adding or removing files.

## Mock mode (no server, no credentials)

The `-mock` launch argument swaps in `MockMediaService`: 2,400 generated "photos" (drawn in code,
no bundled images) over four years, albums, people, memories, places, fake latency so thumbhash
placeholders and lazy month loading are visible. The login screen's *Explore with Sample Library*
does the same at runtime. SwiftUI previews use it too.

```sh
SIM="iPhone 17 Pro"
xcrun simctl boot "$SIM"
xcrun simctl install booted build/DerivedData/Build/Products/Debug-iphonesimulator/Memories.app
xcrun simctl launch booted it.davideghiotto.memories -mock
```

(build with `-derivedDataPath build/DerivedData` for that path.) Deep-link arguments, combinable
with `-mock`:

| Argument | Effect |
|---|---|
| `-mockCount 50000` | size of the fixture library (scroll/perf check) |
| `-initialTab collections` | `library` / `collections` / `search` |
| `-libraryMode months` | `years` / `months` / `all` |
| `-columns 13` | grid columns: 3 / 5 / 7 / 13 |
| `-openViewer` / `-openInfo` | open the newest item, optionally with its info sheet |
| `-openSettings` | Settings & Backup sheet |
| `-openMemory` | play the first memory (with `-initialTab collections`) |
| `-searchQuery sunset` | run a smart search |
| `-selectMode` | Library in select mode with a few items selected |

## Sign-in: the homelab account

The login screen leads with a code by email through accounts.davideghiotto.it (`apps/accounts`);
the broker hands back this iPhone's own Immich token. *Sign in with a server password* is the old
form. Settings → *Sign In a TV*, or a TV's QR (`/memories/device?user_code=…`, Associated Domains
`applinks:accounts.davideghiotto.it`), opens the approval sheet. `-accountsURL http://localhost:3190`
and `-approveCode ABCD-EFGH` for local runs; `AccountsClientTests` goes live with
`TEST_RUNNER_ACCOUNTS_TEST_URL=http://localhost:3190`.

## Run on a device

Signing is left as an automatic-signing placeholder (`CODE_SIGN_STYLE: Automatic`,
`DEVELOPMENT_TEAM: ""`). You need to:

1. Open `Memories.xcodeproj`, target *Memories* > *Signing & Capabilities*, pick your team
   (or set `DEVELOPMENT_TEAM` in `project.yml` and regenerate). Same for *MemoriesTests* if you run
   tests on device.
2. If the bundle id `it.davideghiotto.memories` is taken on your team, change
   `PRODUCT_BUNDLE_IDENTIFIER` in `project.yml`.
3. Background Modes (`fetch`, `processing`) and `BGTaskSchedulerPermittedIdentifiers` are already in
   the generated Info.plist; automatic signing handles them. No entitlements file is needed.
4. Sign in with `https://memories.davideghiotto.it/immich` and your Immich email/password. The app
   reads `<server>/.well-known/immich` (`{"api":{"endpoint":"/api"}}`) to find the API, checks
   `/server/version`, logs in, and stores the token in the Keychain (after-first-unlock, so
   background uploads work while locked).

## Home network URL

*Settings > Home Network*: e.g. `http://<nas-ip>:2283`. On every network change the app pings
`<lan>/api/server/ping` (2 s timeout) and uses the LAN address when it answers, the public URL
otherwise. This replaces SSID matching on purpose: reading the Wi-Fi name needs the *Access Wi-Fi
Information* entitlement plus location permission. iOS asks for Local Network permission the first
time. `NSAllowsArbitraryLoads` is on because the LAN URL is plain HTTP on a user-typed address.

## Backup

*Settings > Backup* (avatar in Collections, or `…` in Library).

- PhotoKit read/write authorization; limited access backs up only the picked items.
- Newest first. For each item the original resource is exported to `Caches/backup-staging/`
  (`isNetworkAccessAllowed`, so iCloud-only originals download first) and hashed with streaming
  SHA-1 (CryptoKit `Insecure.SHA1`).
- Batches of 8 go to `POST /assets/bulk-upload-check` (base64 checksums). Duplicates are recorded
  as backed up with the server's asset id; `unsupported-format` is listed as skipped.
- Accepted files: a `multipart/form-data` body is written to disk (file streamed in 1 MB chunks,
  fields `fileCreatedAt`, `fileModifiedAt`, `filename`, `isFavorite`, `duration`,
  `livePhotoVideoId`; v3 has no `deviceAssetId`/`deviceId`) and sent by a **background
  URLSession** `uploadTask(fromFile:)` with `x-immich-checksum` (hex). Uploads continue while the
  app is suspended; iOS relaunches it for completion events.
- Live photos: the paired video goes first (`visibility=hidden`), then the still with
  `livePhotoVideoId=<video id>`. The chaining happens in the session delegate, so it completes in
  the background too.
- **100 MB:** Cloudflare rejects bodies over 100 MB on the public hostname. Such items are skipped
  with that reason and retried automatically when the LAN URL is active. A 413 from the server is
  treated the same way.
- **Wi-Fi only** (default on) sets `allowsCellularAccess`/`allowsExpensiveNetworkAccess` per
  request and pauses a pass on cellular. **Include videos** toggles video items.
- State (`local identifier -> remote id`, skipped items, last run) persists in
  `Application Support/backup-state.json`.
- Triggers: toggle on, *Back Up Now*, PhotoKit change observer, `BGProcessingTask`
  (`it.davideghiotto.memories.backup`, ~25 min budget) and `BGAppRefreshTask`
  (`…backup-refresh`, ~20 s). iOS decides when background tasks actually run.
- In mock mode a pass enumerates and hashes the simulator's photos but uploads nothing.

## Free up space and Save to iPhone

`Backup/SpaceSaver.swift`. The server is the library; the iPhone keeps what you choose.

- **Free up space** (*Settings > iPhone Storage*): candidates are backed-up items still in Photos,
  older than *Keep on iPhone* (default 30 days), not favorites (toggle), not edited (backup sends
  the unedited original, edits would be lost), not hidden or shared-album. Each one is re-checked
  with `GET /assets/{id}` (exists, not trashed, not offline, checksum = the uploaded SHA-1, live
  photos still paired); a 404 drops the record so it uploads again. The grid thumbnail is pinned in
  `Application Support/offline-thumbnails` (no pin, no delete), then one
  `PHAssetChangeRequest.deleteAssets` call, at most 1,000 items per run.
- iOS always shows its own confirmation, and deleted items sit 30 days in Recently Deleted. With
  iCloud Photos on, the delete reaches iCloud too. *Automatically* = at most once every 20 h, only
  in the foreground, only with backup on (after a pass or when the app becomes active).
- Opening a freed item loads the server preview and keeps it in the image cache; items still on
  the iPhone show (and videos play) from PhotoKit, offline (`DeviceIndex` maps server id -> local id
  from the backup records).
- **Save to iPhone** (viewer `…` menu, Info sheet, selection bar): downloads `/assets/{id}/original`
  (plus the live-photo video as `.pairedVideo`) into Photos with date, favorite and location, and
  records it as backed up with the server checksum.

## Architecture

```
Memories/
  App/          MemoriesApp + AppDelegate (BG tasks, background-session events), AppModel, LaunchOptions, RootView/TabView
  Networking/   APIClient (async URLSession, Bearer), ServerEndpoints (discovery, LAN probing), Keychain, DTOs (v3.4.0)
  Services/     MediaService protocol, RemoteMediaService (Immich), MockMediaService + MockArt (fixtures)
  Images/       ImagePipeline (NSCache + disk cache + request coalescing/cancel), ThumbHash (port), AssetImage
  Library/      AssetSource (TimelineStore: month buckets, lazy loading; AssetListStore: paged search),
                Grid/ (UICollectionView grid, arithmetic layout, cell), LibraryScreen, Months/Years
  Viewer/       ViewerView (paging, chrome, filmstrip), ZoomableImageView, players (AVKit, live photo), InfoSheet, ShareLink payload
  Collections/  Collections screen, album/person/favorites/trash grids, places map
  Memories/     Ken Burns slideshow
  Search/       smart search + suggestion chips
  Settings/     account, backup, home network
  Backup/       BackupManager, PhotoLibrarySource, BackgroundUploader, MultipartBody, models
MemoriesTests/  Swift Testing: DTO decoding, thumbhash vs reference vectors, multipart, SHA-1, timeline, layout
tools/make-icon.swift   regenerates the app icon PNGs
```

- **Grid is UIKit** (`UICollectionView` in a `UIViewControllerRepresentable`). The layout computes
  attributes for a rect from row arithmetic, so 50k items cost the same as 50; the timeline knows
  every month's count from `/timeline/buckets` up front, so the grid is sized for the whole library
  and opens pinned to the newest item while months load as they approach the screen. Cells cancel
  their image task on reuse; `prefetchDataSource` warms buckets and thumbnails. Pinch steps
  3/5/7/13 columns around the finger; drag-to-select uses a horizontal pan with edge autoscroll.
- **Viewer** is presented from the grid with UIKit's zoom transition (`preferredTransition =
  .zoom`), which provides the cell-to-fullscreen animation and the interactive swipe-down dismiss
  back into the (scrolled-into-view) cell. Pages are a SwiftUI paging `ScrollView`; photos zoom in a
  `UIScrollView`.
- Swift 6 language mode with complete strict concurrency, zero warnings.

## Known gaps

- Nothing has run against a real account (no credentials were available): login, every
  authenticated endpoint, video/live-photo playback, original download for sharing, and backup
  uploads are verified only by compiling against the v3.4.0 DTOs and by unit tests on recorded
  shapes. `GET /server/version` was checked against the live server.
- Background upload, BGProcessingTask and Local Network/LAN switching need a physical device.
- Mock mode has no motion files: videos show a poster, live photos fake playback with a scale pulse.
- Not built: album creation/editing, sharing links, people naming, Hidden/Locked folder, Duplicates,
  multi-item share, the year->month scroll position when tapping a Year card, iPad layout.
