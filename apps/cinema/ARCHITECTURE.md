# Cinema — custom Jellyfin web client

A React front-end that talks to an unmodified Jellyfin server over its REST API.
No server fork, no plugin, no patched `jellyfin-web`. Jellyfin does the hard
work (metadata, transcoding, users, sessions); this owns 100% of the interface.

---

## 1. System shape

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  Browser                │         │  Jellyfin server :8096       │
│                         │         │  (unmodified)                │
│  Cinema (this app)      │         │                              │
│   React + shadcn/ui     │         │  • metadata + scraping       │
│   @jellyfin/sdk ────────┼────────▶│  • users / auth / sessions   │
│   hls.js                │  /jf/*  │  • ffmpeg transcoding        │
│                         │         │  • serves media bytes        │
└─────────────────────────┘         └──────────────────────────────┘
             │                                     ▲
             │  Vite dev server proxies /jf ───────┘
             │  (prod: one reverse proxy, same origin)
```

**Everything goes through `/jf`.** `createApi()` is given the *relative* base
path `/jf`, which the SDK passes straight to axios without normalising. So every
request — API calls, images, video byte ranges, subtitle tracks — resolves
against our own origin and is forwarded by the proxy.

Two problems disappear as a result:

- **CORS never happens.** Same-origin requests, so no preflight, no server config.
- **`api_key` in stream URLs stays same-origin**, so no token leaks cross-domain.

In production, put this app's `dist/` and Jellyfin behind one Caddy/nginx and
keep `/jf` pointed at the server. `vite.config.ts` is the only place the real
Jellyfin address appears, read from `JELLYFIN_URL` at dev-server startup.

---

## 2. Folder structure

```
src/
├── lib/
│   ├── utils.ts                 cn() — the shadcn class merger
│   └── jellyfin/                ← ALL server knowledge lives here
│       ├── client.ts            SDK instance, device id, relative base path
│       ├── auth.tsx             AuthProvider, useAuth, token persistence
│       ├── device-profile.ts    browser codec capabilities
│       ├── images.ts            artwork URL builders
│       ├── ticks.ts             .NET ticks ↔ seconds, formatting
│       ├── queries.ts           TanStack Query hooks + query keys
│       └── playback.ts          PlaybackInfo negotiation + session reporting
│
├── components/
│   ├── ui/                      shadcn primitives (button, input, badge, …)
│   ├── media/                   MediaCard, MediaRow, HeroBanner
│   └── layout/                  AppShell, TopNav
│
├── features/player/             VideoPlayer, PlayerControls, usePlaybackSession
├── routes/                      one file per screen
├── App.tsx                      routing + auth gate
├── main.tsx                     providers
└── index.css                    ← the entire design system
```

The rule that keeps this maintainable: **nothing outside `lib/jellyfin/` imports
from `@jellyfin/sdk`.** Components receive plain data and call hooks. When the
Jellyfin API changes, exactly one directory changes.

---

## 3. Data layer

Three layers, each with one job.

| Layer | File | Responsibility |
|---|---|---|
| Transport | `client.ts` | One `Api` instance per access token |
| Session | `auth.tsx` | Who am I, is the token still valid |
| Server state | `queries.ts` | Fetching, caching, invalidation |

**Auth.** `signIn()` authenticates with a tokenless client, then stores
`{ accessToken, userId }` in `localStorage` and swaps in an authenticated `Api`.
On boot, a restored token is validated with `getCurrentUser()` before the UI
renders — a stale token must not leave you half-signed-in.

> localStorage is an XSS-exposed store. For localhost personal use that's an
> acceptable trade. If you ever expose this to the internet, move the token to
> an httpOnly cookie, which means adding a small server — that's the one real
> argument for Next.js here.

**Queries.** TanStack Query owns all server state. There is no Redux/Zustand
store, because almost nothing in this app is genuinely client state. Query keys
are centralised in `queryKeys` so the player can invalidate `['resume']` when
playback stops and Continue Watching updates itself.

`ItemFields` is requested explicitly: `CARD_FIELDS` for grids, `DETAIL_FIELDS`
(which includes `MediaSources` and `MediaStreams`) for the detail page. Asking
for everything everywhere is the single easiest way to make a large library feel
slow.

---

## 4. Playback — the part that matters

This is where a naive client gets it wrong and transcodes 4K on every play.
**You never construct a stream URL from an item id.** You negotiate.

```
 1. POST /Items/{id}/PlaybackInfo
        body: { DeviceProfile, UserId, StartTimeTicks, … }
        │
        │  DeviceProfile = getBrowserDeviceProfile() from the official SDK.
        │  It probes canPlayType() + MediaSource.isTypeSupported() and
        │  declares every container/codec/bitrate this browser can decode.
        │  DO NOT hand-roll this.
        ▼
 2. Server replies: MediaSources[0] + PlaySessionId
        │
        ├── SupportsDirectPlay ──▶ /Videos/{id}/stream.{container}?Static=true
        │   or SupportsDirectStream   …&mediaSourceId=&api_key=&Tag=
        │                             Server does ~no work. This is the goal.
        │
        └── neither ─────────────▶ use MediaSources[0].TranscodingUrl verbatim
                                     (relative, already carries its own params).
                                     ffmpeg is now running on your server.
        ▼
 3. Delivery
        progressive file → video.src = url
        HLS             → native on Safari, hls.js everywhere else
        ▼
 4. Report the session, or things silently break:
        POST /Sessions/Playing            once, on start
        POST /Sessions/Playing/Progress   every 10s
        POST /Sessions/Playing/Stopped    on unmount  ← ALSO KILLS THE TRANSCODE
```

Skip step 4 and two things go wrong: Continue Watching never populates, and
**ffmpeg keeps running on your server after you close the tab.**

`usePlaybackSession` owns steps 1, 2 and 4 and hands back a ref. `VideoPlayer`
owns step 3 and nothing else — it's deliberately dumb, so the same session logic
could later drive a different playback engine.

Two subtleties encoded in the code:

- **Seeking.** A transcode already starts at the requested offset, so only seek
  the element when direct playing. Seeking an HLS transcode restarts it.
- **Subtitles.** Only `DeliveryMethod === External` tracks become `<track>`
  elements. `ssaExternal: true` in the device profile asks for SSA/ASS as
  separate tracks rather than burning them in — burn-in forces a full re-encode.

**The play-method badge in the player is your diagnostic.** If it says
"Transcoding" on a file you expected to direct play, the culprit is nearly
always audio (AC3/E-AC3/DTS/TrueHD, which no Chrome build decodes) or an MKV
container. That's the browser's limit, not a bug — and it's the reason a native
client like Swiftfin exists for the living room.

---

## 5. Design system

`src/index.css` is the whole thing. Standard shadcn/ui token names in oklch, so
any component from the shadcn registry drops in unchanged.

To re-skin the app, change `--primary`. To change the shape language, change
`--radius`. Dark-only by intent — it's a cinema, not a dashboard.

`components.json` is configured, so `npx shadcn@latest add dialog` works and new
components inherit the theme automatically.

---

## 6. Local test with one movie

1. **Run Jellyfin** (Docker is easiest):

   ```bash
   docker run -d --name jellyfin -p 8096:8096 \
     -v jellyfin-config:/config -v jellyfin-cache:/cache \
     -v /path/to/your/media:/media:ro \
     jellyfin/jellyfin:latest
   ```

2. **Name the file so the scraper can match it.** This matters more than
   anything else:

   ```
   /media/movies/Blade Runner 2049 (2017)/Blade Runner 2049 (2017).mkv
   ```

3. Open `http://localhost:8096`, finish setup, add a **Movies** library pointing
   at `/media/movies`, let it scan.

4. **Run Cinema:**

   ```bash
   cp .env.example .env      # set JELLYFIN_URL if not localhost:8096
   npm install
   npm run dev               # → http://localhost:5173
   ```

5. Sign in with your Jellyfin user. You should see the movie, a detail page with
   a Media panel showing container/codec/bitrate, and playback with a badge
   reading `DirectPlay`, `DirectStream` or `Transcoding`.

**To deliberately test the transcode path** (worth doing once, so you know it
works), pass a low ceiling in `PlayerRoute`:

```ts
usePlaybackSession({ itemId, startSeconds, maxStreamingBitrate: 3_000_000 })
```

The badge should flip to `Transcoding` and `docker stats jellyfin` should show
CPU climbing.

---

## 7. Media on a removable drive

An external disk is a first-class source: mount it into the Jellyfin container
and point a library at it. Nothing in this app knows or cares that the bytes
live on USB — with one exception, below.

**Mount it read-only, and not underneath another read-only mount.** Docker
cannot create a mountpoint inside a read-only bind, so `-v /media:ro` plus
`-v /Volumes/Drive:/media/drive:ro` fails at container start with
`read-only file system`. Give the drive its own root:

```bash
docker run -d --name jellyfin --restart unless-stopped -p 8096:8096 \
  -v jellyfin-config:/config -v jellyfin-cache:/cache \
  -v /Volumes/Drive:/mnt/drive:ro \
  jellyfin/jellyfin:latest
```

Mounting the drive *root* rather than the film folder is worth it: adding a
second library later is then a dashboard change, not a container rebuild.
Config and cache are named volumes, so recreating the container keeps users,
libraries and watch history.

Turn **real-time monitoring off** on a removable library. The watcher exists to
catch files appearing in a folder that is always there; on a disk that comes and
goes it just churns.

### Detecting that the drive is gone

This is the part that needed code. **Jellyfin does not notice.** Its metadata
lives in its own database, so an unplugged disk changes none of its answers —
verified against 10.11:

| Endpoint | Drive present | Drive gone |
|---|---|---|
| `/Items` | returns the film | returns the film |
| `/Items/{id}/PlaybackInfo` | 200, `SupportsDirectPlay: true` | **200, `SupportsDirectPlay: true`** |
| `/Videos/{id}/stream` | 206 | **404** |

So the negotiation you would normally trust says everything is fine, and the
first hint of trouble is a video element that fails to decode. `src/lib/jellyfin/availability.ts`
asks the only endpoint that tells the truth, for one byte:

```
GET /Videos/{id}/stream?Static=true   Range: bytes=0-0   cache: no-store
```

`cache: 'no-store'` is load-bearing, not hygiene. Without it the browser
replays the cached 206 from the last successful probe and the check silently
passes forever after the drive is pulled. That is exactly what the first
version of this did.

`mediaSourceId` is optional in that URL — the server falls back to the item's
default source — which is what lets a grid card carrying only `CARD_FIELDS` be
probed without refetching `MediaSources`.

Three consumers, each paying for what it needs:

- **LibraryRoute** probes the first item only, and shows one banner over the
  grid. Without it you get a wall of perfectly good posters — artwork comes
  from Jellyfin's metadata folder, not the drive — that all fail on click.
- **ItemRoute** probes its own item and replaces Play with an offline notice.
- **PlayerRoute** probes *only after* playback has already failed, to turn
  "the browser could not decode this stream" into the actual reason.

Each offers a "Check again" that refetches, and the query is
`refetchOnWindowFocus`, so replugging the drive and returning to the tab
recovers on its own.

---

## 8. What's built vs. what's next

**Working:** auth + session restore, library views, Netflix-style home with hero
and carousels, sortable library grid, search, detail page with technical media
panel, direct-play/transcode negotiation, HLS via hls.js, external subtitles,
custom controls with keyboard shortcuts, progress reporting and resume,
offline-storage detection for libraries on removable drives.

**Deliberately left out** — in rough order of value:

1. **Series navigation.** `useNextUp` exists and episodes render, but there's no
   season/episode browser. Add `getSeasons` / `getEpisodes` from `getTvShowsApi`.
2. **Audio & subtitle pickers mid-playback.** Changing `audioStreamIndex` means
   re-running `resolvePlaybackSource` and resuming at the current position —
   the plumbing is already parameterised for it.
3. **Quality selector.** Same mechanism as the transcode test above.
4. **Virtualised grid.** Fine to ~500 items; past that use TanStack Virtual.
5. **PWA / offline.** Not worth much here: Safari can't decode most of what you
   care about anyway.

## 9. Verified

- `tsc -b` and `vite build` clean; initial bundle 501 kB (143 kB gzip), with
  hls.js and the player split into a lazy chunk.
- The `/jf` proxy path rewrite confirmed against a mock server.
- Auth header format, token injection, relative-base URL construction, the
  `PlaybackInfo` POST carrying a device profile, direct-play URL parameters and
  sidecar-subtitle URL prefixing all confirmed against a mock Jellyfin.

Against a real Jellyfin 10.11.11 in Docker, with a movie library on an external
HFS+ drive bind-mounted read-only:

- Sign-in, home carousels, library grid and detail page all render real data.
- Playback of an h264/AAC MP4 off the drive: `readyState 4`, 1916×812,
  `DirectPlay`, position advancing, no transcode.
- Drive-gone behaviour reproduced by renaming the files underneath the server.
  `PlaybackInfo` kept answering 200 with `SupportsDirectPlay: true`; only the
  stream endpoint turned 404 — which is what section 7 is built on.
- Offline UI confirmed in all three places (library banner, detail page, player)
  and recovery confirmed both by "Check again" and by reload after restoring
  the files.
