# Memories clients — design spec

Two first-party clients for the NAS's Immich (v3.4.0), styled after iOS 26 Photos:

- `web/` — React + Vite + TypeScript + Tailwind v4 (PWA-capable, works on desktop and phone).
- `ios/` — SwiftUI, iOS 26, generated with XcodeGen (`project.yml`), no third-party deps unless unavoidable.

Both talk to Immich's REST API. Neither forks Immich.

## Server

| | |
|---|---|
| Public base URL (native app) | `https://memories.davideghiotto.it/immich` -> API at `/immich/api` |
| LAN | `http://<nas-ip>:2283/api` |
| Version | `GET /api/server/version` -> `{"major":3,"minor":4,"patch":0}` |
| OpenAPI | `immich-app/immich` tag `v3.4.0`, `open-api/immich-openapi-specs.json` |

Auth: `POST /api/auth/login {email,password}` -> `LoginResponseDto.accessToken`. Send as
`Authorization: Bearer <token>`; the login also sets cookie `immich_access_token`, which is what
lets a same-origin web `<img src>` work. `x-api-key` header also accepted.

### Endpoints used

| Feature | Call |
|---|---|
| Timeline index | `GET /timeline/buckets?visibility=timeline&withStacked=true` -> `[{timeBucket:"2024-05-01", count}]` (month buckets) |
| Timeline month | `GET /timeline/bucket?timeBucket=2024-05-01&visibility=timeline&withStacked=true` -> **columnar** `TimeBucketAssetResponseDto` (`id[]`, `ratio[]`, `thumbhash[]`, `fileCreatedAt[]`, `localOffsetHours[]`, `isImage[]`, `duration[]`, `isFavorite[]`, `livePhotoVideoId[]`, `city[]`, `country[]`, `stack[]`) |
| Favorites / person / album timeline | same two calls with `isFavorite=true`, `personId=`, `albumId=` |
| Thumbnail | `GET /assets/{id}/thumbnail?size=thumbnail` (grid), `size=preview` (viewer), `size=fullsize`; add `&c=<thumbhash>` as cache-buster |
| Original / video | `GET /assets/{id}/original`, `GET /assets/{id}/video/playback` (HLS: `/assets/{id}/video/stream/main.m3u8`) |
| Asset detail | `GET /assets/{id}` (exifInfo, people, localDateTime) |
| Favorite / archive / trash | `PUT /assets {ids, isFavorite}`; `DELETE /assets {ids, force:false}` |
| Albums | `GET /albums`, `GET /albums?isShared=true`, `GET /albums/{id}` |
| People | `GET /people?size=500`, `GET /people/{id}/thumbnail` |
| Memories | `GET /memories?for=<YYYY-MM-DD>` -> `MemoryResponseDto[]` (`data.year`, `assets[]`, type `on_this_day`/`birthday`) |
| Places | `GET /map/markers`, `GET /search/explore` (`fieldName: exifInfo.city`) |
| Search | `POST /search/smart {query, size:100, withExif:false}` -> `assets.items[]`, `nextCursor` |
| Suggestions | `GET /search/suggestions?type=...` |
| Upload | `POST /assets/bulk-upload-check {assets:[{id,checksum(sha1 base64)}]}` then multipart `POST /assets` with `assetData`, `fileCreatedAt`, `fileModifiedAt`, `filename`, `duration`, `isFavorite`, `livePhotoVideoId`; header `x-immich-checksum: <sha1>`. Status `created`/`duplicate`. v3 has **no** `deviceAssetId`/`deviceId`. |

Cloudflare caps one request at 100 MB on the public URL — upload big videos over LAN URL.

## Look: iOS 26 Photos

### From REA (shipped-artifact evidence, `/System/Applications/Photos.app`, `rea inspect-asset-catalog`)

Observed asset-catalog colors (Evidence `ev_5c7d7c55…82f30`, authority shipped-artifact):

| Token | Light | Dark |
|---|---|---|
| `ThumbnailPlaceholderColor` | sRGB 0.80 gray `#CCCCCC` | sRGB 0.20 gray `#333333` |
| `WidgetBackgroundColor` | `#FFFFFF` | P3 (0.110, 0.110, 0.118) ~ `#1C1C1E` |
| `WidgetAccentColor` | P3 (0.275, 0.467, 0.933) ~ `#4677EE` | P3 (0.306, 0.502, 0.933) ~ `#4E80EE` |

Observed badge set (names only; draw our own with SF Symbols / Lucide, never ship Apple's bitmaps):
Live Photo on/off, Video + duration, Burst, GIF, SloMo, Timelapse, Portrait (SDOF), Edited,
Favorite on/off, Pin/Place, HDR. App-icon gradient is an 8-petal flower — **do not copy**;
our icon is our own.

Inference: the remaining chrome uses system semantic colors (systemBackground, label,
secondaryLabel, systemBlue). Values below come from Apple's HIG semantic palette, not REA.

### Tokens

```
bg            light #FFFFFF  dark #000000   (Library grid is pure black in dark)
bg-grouped    light #F2F2F7  dark #000000
card          light #FFFFFF  dark #1C1C1E
label         light #000000  dark #FFFFFF
label-2       light #3C3C4399 (60%) dark #EBEBF599
separator     light #3C3C434A dark #54545899
accent        #0A84FF (dark) / #007AFF (light)   (system blue)
favorite      white heart badge on grid cells; filled heart in viewer toolbar uses label color
placeholder   #CCCCCC / #333333   (REA)
glass         blurred material: backdrop-filter: blur(30px) saturate(180%); bg rgba(255,255,255,.55) light / rgba(30,30,30,.55) dark; 0.5px hairline border rgba(255,255,255,.25)
font          -apple-system, "SF Pro Text", system-ui; titles SF Pro Display
large title   34pt bold, tracking 0.37
header date   17pt semibold over a top gradient scrim
radius        cards 16, album covers 10, glass capsules 999
```

### Structure (iOS 26)

Tab bar: floating Liquid-Glass capsule at bottom with **Library** and **Collections**, plus a
separate circular **Search** button to its right.

**Library**
- Full-bleed photo grid, square crops, 1–2 px gutters, newest at bottom (opens scrolled to end).
- Floating glass controls top: large title area shows current "Month Year" + place subtitle while
  scrolling; right side glass capsule buttons "Select" and "…" (filter/sort).
- Bottom segmented glass control: **Years · Months · All**.
  - Years: one big card per year (photo key art, year label bold over it).
  - Months: one card per month ("May 2024", city subtitle), key photo full-width, rounded 16.
  - All: grid; pinch zoom cycles column counts 3 -> 5 -> 7 -> 13 (phone) and 5/8/12/20 on desktop.
- Video badge: duration bottom-right, white 12pt semibold with shadow. Favorite: small white heart bottom-left.
- Placeholder color = `ThumbnailPlaceholderColor`; fade-in from thumbhash.
- Select mode: tap to toggle, blue circle checkmark bottom-right, drag-to-select across cells.

**Collections** (scrolling list of sections, each with a chevron header "Albums >"):
Pinned (horizontal: Favorites, Recently Saved, Map, Videos), Albums (2-row horizontal grid of
square covers + name + count), People & Pets (circle avatars), Memories (tall 3:4 cards with
title + year over photo), Trips/Places, Media Types (list rows with SF-style icons: Videos,
Selfies, Live Photos, Portrait, Panoramas, Screenshots…), Utilities (Recently Deleted, Hidden,
Duplicates, Imports).

**Viewer**
- Black bg, image fit, swipe left/right, swipe down to dismiss (shrinks back to grid cell), tap
  toggles chrome, pinch / double-tap zoom.
- Top: glass back button, date + time centered ("12 May 2024 · 18:42"), place below.
- Bottom glass bar: Share, Favorite (heart), Info (i), Delete (trash). Above it a filmstrip
  scrubber of neighbouring thumbnails.
- Info sheet (swipe up): caption, date, camera/lens/exif row, people circles, mini map.
- Live photo: long-press plays the motion video. Videos: native controls, inline scrubber.

**Memories player**: full-screen, auto-advancing Ken-Burns slideshow, title "On this day · 2021".

**Search**: glass search field, suggestion chips (People, Places, Categories), results grid;
uses Immich smart (CLIP) search.

**Backup (iOS)**: Settings sheet from avatar: server URL, login, "Back Up" toggle,
progress ring, Wi-Fi only, include videos. Background via `BGProcessingTask` +
PhotoKit change observer.
Web: drag-and-drop / file picker upload with progress list.

## Things not to do

- Do not ship Apple's images, icons, fonts files, or the app-icon artwork. SF Symbols are fine in
  the native iOS app (licensed for Apple platforms); the web uses Lucide.
- Do not name anything "Photos" or "iCloud". Product name: **Memories**.
