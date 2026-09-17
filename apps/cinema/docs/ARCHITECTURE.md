# Architecture

A React front end against an **unmodified** Jellyfin server. No server fork, no plugin, no patched
`jellyfin-web`. Jellyfin does metadata, users, sessions, transcoding and bytes; this owns the whole
interface.

Design rules are in [DESIGN.md](DESIGN.md); shipping it is [DEPLOY.md](DEPLOY.md); what is done and
what is next is [ROADMAP.md](ROADMAP.md).

---

## 1. System shape

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  Browser                │         │  Jellyfin server             │
│  Cinema (apps/web)      │         │  (unmodified)                │
│   React + @jellyfin/sdk ├────────▶│  metadata, auth, ffmpeg,     │
│   hls.js                │  /jf/*  │  media bytes                 │
└─────────────────────────┘         └──────────────────────────────┘
             │                                     ▲
             │  dev: the Vite proxy ───────────────┘
             │  prod: nginx, same origin
```

**Everything goes through the relative base path `/jf`.** `createApi()` is given `/jf`, which the
SDK passes straight to axios without normalising, so API calls, images, video byte ranges and
subtitle tracks all resolve against our own origin and are forwarded by the proxy.

Two problems disappear: **CORS never happens**, and **`api_key` in stream URLs never crosses an
origin**. `apps/web/vite.config.ts` is the only place the real Jellyfin address appears in
development, read from `JELLYFIN_URL` in the repo-root `.env`; in production the same role is
played by `JELLYFIN_UPSTREAM` in `services/web/compose.yaml`. Never put an absolute Jellyfin URL in
app code.

---

## 2. Layout of `apps/web`

```
src/
├── lib/jellyfin/          ← ALL server knowledge lives here
│   ├── client.ts          SDK instance, device id, the relative base path
│   ├── auth.tsx           AuthProvider, useAuth, token persistence
│   ├── device-profile.ts  browser codec capabilities
│   ├── images.ts          artwork URL builders
│   ├── ticks.ts           .NET ticks ↔ seconds, formatting
│   ├── queries.ts         TanStack Query hooks + query keys
│   ├── playback.ts        PlaybackInfo negotiation + session reporting
│   └── availability.ts    is the file actually reachable (see § 5)
├── components/            ui/ (primitives), media/, layout/
├── features/player/       VideoPlayer, PlayerControls, usePlaybackSession
├── routes/                one file per screen
├── styles/tokens.css      ← generated; never edit
└── index.css              ← the entire skin
```

**Nothing outside `lib/jellyfin/` imports from `@jellyfin/sdk`.** Components take plain data and
call hooks. When the Jellyfin API changes, exactly one directory changes — and that boundary is
what let the SDK become a single shared bundle chunk with a config change rather than a refactor.

---

## 3. Data layer

| Layer | File | Job |
|---|---|---|
| Transport | `client.ts` | One `Api` per access token |
| Session | `auth.tsx` | Who am I, is the token still valid |
| Server state | `queries.ts` | Fetching, caching, invalidation |

**Auth.** `signIn()` authenticates with a tokenless client, stores `{ accessToken, userId }` in
`localStorage`, and swaps in an authenticated `Api`. On boot a restored token is validated with
`getCurrentUser()` before the UI renders — a stale token must not leave you half-signed-in.

> localStorage is XSS-exposed. Acceptable for this; if the threat model changes, the token moves to
> an httpOnly cookie, which means adding a server.

**Queries.** TanStack Query owns all server state — no Redux, no Zustand, because almost nothing
here is genuinely client state. Keys are centralised in `queryKeys` so the player can invalidate
`['resume']` on stop and Continue Watching updates itself.

Request `ItemFields` explicitly: `CARD_FIELDS` for grids, `DETAIL_FIELDS` (with `MediaSources` and
`MediaStreams`) for the detail page. Asking for everything everywhere is the easiest way to make a
large library feel slow.

---

## 4. Playback

This is where a naive client transcodes 4K on every play. **Never construct a stream URL from an
item id. Negotiate.**

```
 1. POST /Items/{id}/PlaybackInfo   { DeviceProfile, UserId, StartTimeTicks }
        DeviceProfile = getBrowserDeviceProfile() from the SDK. It probes
        canPlayType() + MediaSource.isTypeSupported(). DO NOT hand-roll it.
 2. Server replies MediaSources[0] + PlaySessionId
        SupportsDirectPlay/DirectStream → /Videos/{id}/stream.{container}?Static=true…
                                          the server does ~no work. This is the goal.
        neither                         → MediaSources[0].TranscodingUrl, verbatim.
                                          ffmpeg is now running on your server.
 3. Delivery: progressive → video.src; HLS → native on Safari, hls.js elsewhere
 4. Report: POST /Sessions/Playing (start), /Progress (10s), /Stopped (unmount)
```

**Step 4 is not optional.** Skip `/Stopped` and Continue Watching never populates *and* ffmpeg
keeps running after the tab closes.

`usePlaybackSession` owns 1, 2 and 4 and hands back a ref; `VideoPlayer` owns 3 and is deliberately
dumb, so the same session logic could drive another engine.

Two subtleties encoded in the code:

- **Seeking.** A transcode already starts at the requested offset, so seek the element only when
  direct playing. Seeking an HLS transcode restarts it.
- **Subtitles.** Only `DeliveryMethod === External` tracks become `<track>` elements.
  `ssaExternal: true` asks for SSA/ASS as separate tracks rather than burning them in — burn-in
  forces a full re-encode.

**The play-method badge in the player is the diagnostic.** "Transcoding" on a file you expected to
direct play is nearly always audio (AC3/E-AC3/DTS/TrueHD, which no Chrome build decodes) or an MKV
container. That is the browser's limit, and the reason native clients exist for the living room.

---

## 5. Media on a removable drive

Mount the drive **read-only at its own root** — Docker cannot create a mountpoint inside another
read-only bind — and turn real-time monitoring off on that library. `services/jellyfin/dev.sh`
decides the mount set at startup and recreates the container when it changed, so the stack comes up
with the drive unplugged; `/config` and `/cache` are named volumes, so nothing is lost.

**Jellyfin does not notice that the disk is gone.** Its metadata is in its own database — verified
against 10.11:

| Endpoint | Drive present | Drive gone |
|---|---|---|
| `/Items` | returns the film | returns the film |
| `/Items/{id}/PlaybackInfo` | 200, `SupportsDirectPlay: true` | **200, `SupportsDirectPlay: true`** |
| `/Videos/{id}/stream` | 206 | **404** |

So `availability.ts` asks the only endpoint that tells the truth, for one byte:

```
GET /Videos/{id}/stream?Static=true   Range: bytes=0-0   cache: no-store
```

`cache: 'no-store'` is load-bearing, not hygiene: without it the browser replays the cached 206 from
the last successful probe and the check passes forever after the drive is pulled. `mediaSourceId` is
optional — the server falls back to the item's default source — which is what lets a grid card
carrying only `CARD_FIELDS` be probed without refetching `MediaSources`.

Three consumers, each paying for what it needs: **LibraryRoute** probes the first item only and
shows one banner (artwork comes from Jellyfin's metadata folder, so the posters all look fine);
**ItemRoute** probes its own item and replaces Play with an offline notice; **PlayerRoute** probes
only *after* playback failed, to turn "could not decode" into the real reason. Each offers "Check
again", and the query is `refetchOnWindowFocus`, so replugging recovers on its own.

---

## 6. Licensing — three clients, three obligations

Getting this wrong is expensive late and free now.

- **`apps/web` — ours.** Written against the REST API; using an API is not derivative work. Never
  copy code out of `jellyfin-web` (GPLv3) into it. A CSS technique is not code; a component is.
- **`apps/ios` — Swiftfin, MPL-2.0.** File-scoped copyleft: modified Swiftfin files stay MPL and
  must be published, new files can be ours, **App Store distribution is fine**. That is the reason
  iOS forks Swiftfin. Keep the upstream `LICENSE` and attribution intact.
- **`apps/android` — Findroid, GPLv3.** Whole-work copyleft: distributing a build means publishing
  this fork's complete source. Google Play is fine with that.

Both forks are vendored into this private repository, which is **mere aggregation** — GPL and MPL
code sitting side by side in one tree does not relicense either. But the public fork repositories
used to be how the modified sources were published, and they are being retired, so:

> **Before any iOS or Android build is distributed to anyone**, the corresponding source has to be
> published somewhere the recipient can reach — the modified Swiftfin files for MPL-2.0, the entire
> Findroid fork for GPLv3. Making this repository public would satisfy both; a public mirror of
> each `apps/<platform>/` tree would too. Nothing is owed while the builds stay on your own
> devices.

**The one rule: never move code between `apps/ios` and `apps/android`.** GPLv3 code entering the
Swiftfin fork relicenses it, and a GPLv3 app cannot ship on the App Store at all — Apple's terms
impose restrictions GPLv3 forbids, which is what got GNU Go pulled. Shared logic goes in
`packages/`, written by us, or it gets written twice. Generated files (`CinemaTokens.swift`,
`CinemaTokens.kt`) are ours: they come from `tokens.json`, not from either upstream.

---

## 7. Decisions that look expensive and are not

Do not "simplify" these:

- **The same-origin `/jf` proxy** — § 1 is the whole argument.
- **`lib/jellyfin/` as the only importer of the SDK** — it keeps an SDK upgrade to one directory,
  and it is why bundle fixes are config changes.
- **`tar | ssh` as the deploy** — no registry, no CI, no credentials to rotate. The NAS builds its
  own image because it is x86_64 and the Mac is not.
- **Small, mechanical fork diffs** — `git merge upstream/main` is where server-compatibility fixes
  arrive, and it has to stay cheap forever. A cleanup that grows the diff has cost something.
