# Manga

Download manga chapters and read them. **Only the reader is public**, at
<https://manga.davideghiotto.it>. Finding and downloading stays on the LAN: Suwayomi has no
login, and most sources are unlicensed.

```
Suwayomi (:4567)                 MANGA_ROOT/mangas/<source>/<series>/<chapter>.cbz        Kavita (:5000)          Yomu (:4571)
finds + downloads   ----------->  CBZ with ComicInfo.xml inside  ----------------------->  library, users  <-----  the reader
Mihon extensions                  (bind mount, rw)                (same folder, :ro)      progress, covers        /api allowlist
LAN only                                                                                  LAN only                public, via tunnel
```

Suwayomi writes files and Kavita scans them, with no API link between the two. Yomu talks to
Kavita's REST API and nothing else.

## Where it runs

The mini PC (`debian`), since 2026-09-23, as its own compose project in `~/manga`, a clone of
this repository ([davide97g/manga](https://github.com/davide97g/manga), private). The box pulls
it with a read-only deploy key: `Host github-manga` in its `~/.ssh/config`.

| | |
|---|---|
| Yomu, public | <https://manga.davideghiotto.it>, tunnel ingress to `http://localhost:4571` |
| Yomu, LAN | `http://debian:4571` |
| Suwayomi | `http://debian:4567`, **LAN only** |
| Kavita admin | `http://debian:5000`, **LAN only** |
| Downloads | `~/manga/data` (`MANGA_ROOT=./data`) |

From the Mac, `ssh homelab` may time out on the LAN IP; `ssh -o HostName=${BOX_TAILNET_IP} homelab`
(Tailscale) works.

**Monitoring.** The hub (`monitoring.davideghiotto.it`, repo `../hub`) draws the stack as the
bottom row of `/media`: Suwayomi → Kavita → Yomu, with queue, chapters, folder watching and
container load, and the three appear in Atlas too. Its Kavita key is the admin's `opds` auth
key, read out of `kavita.db` by the hub's `scripts/collect-env.sh`.

**Deploy** (no CI):

```sh
git push
ssh homelab 'cd ~/manga && git pull --ff-only && docker compose up -d --build'
```

`up -d` recreates only the services whose config changed, and the named volumes survive it.

**Cloudflare.** One ingress rule on the mini PC's tunnel, `manga.davideghiotto.it` ->
`http://localhost:4571`, before the catch-all, and a proxied CNAME to the tunnel. It's not behind
Access: Kavita's sign-in is the gate, and the nginx allowlist below is what keeps everything else
of Kavita off the internet. The calls are the ones in `../porting-to-homelab.md` § 5.

## Files

| | |
|---|---|
| `compose.yml` | the three services, the named volumes, and the shared bind mount |
| `web/Dockerfile`, `web/nginx.conf` | Yomu's image: Bun build, nginx serving `dist/` and proxying `/api` |
| `.env.example` | `MANGA_ROOT`, `SUWAYOMI_PORT`, `KAVITA_PORT`, `YOMU_PORT`, `TZ` |
| `.env` | per host, gitignored. Mini PC: `MANGA_ROOT=./data`, default ports. On a Mac, `KAVITA_PORT=5001` (AirPlay holds 5000) |
| `data/` | the downloads (`MANGA_ROOT`), gitignored |

State outside the folder, in Docker named volumes (compose project `manga`):

| Volume | Holds |
|---|---|
| `manga_suwayomi-data` | `server.conf`, the DB (library, installed extensions, read state), extension APKs |
| `manga_kavita-config` | `kavita.db` (admin user, libraries, reading progress), covers, logs |

## Suwayomi

- Image `ghcr.io/suwayomi/suwayomi-server:stable`, v2.3.2243 when it was set up. The web UI and
  GraphQL (`/api/graphql`) are both on 4567, and **neither has auth**.
- `DOWNLOAD_AS_CBZ=true`: one CBZ per chapter, with a `ComicInfo.xml` that holds the series name.
  Kavita relies on that file, so leave it on.
- `AUTO_DOWNLOAD_CHAPTERS=true`: a series in the Suwayomi **Library** downloads new chapters by
  itself.
- `EXTENSION_STORES` sets the extension source (Keiyoushi). **v2 renamed it from
  `EXTENSION_REPOS`, and the old name is silently ignored**, which leaves the Extensions tab
  empty. The startup script writes it into `server.conf`, and Suwayomi rewrote the URL to
  Keiyoushi's `…/index.pb` form, which is fine.
- The container's log is full of `dbus` and `gcm … DEPRECATED_ENDPOINT` errors. They come from the
  bundled Chromium and don't matter.

Scripting it from a shell works with GraphQL alone, since there's no auth:

```sh
q(){ curl -s localhost:4567/api/graphql -H 'content-type: application/json' -d "$1"; echo; }
q '{"query":"{downloadStatus{state queue{state tries chapter{name}}}}"}'
q '{"query":"mutation{updateExtension(input:{id:\"eu.kanade.tachiyomi.extension.all.mangaplus\",patch:{install:true}}){extension{isInstalled}}}"}'
q '{"query":"mutation{fetchSourceManga(input:{source:\"<sourceId>\",type:SEARCH,query:\"One Piece\",page:1}){mangas{id title}}}"}'
q '{"query":"mutation{fetchChapters(input:{mangaId:115}){chapters{id name scanlator}}}"}'
q '{"query":"mutation{enqueueChapterDownload(input:{id:8}){downloadStatus{state}}}"}'
q '{"query":"mutation{startDownloader(input:{}){downloadStatus{state}}}"}'
```

## Kavita

- Image `jvmilazz0/kavita:latest` (the official one). The first visit creates the admin account.
- One library: **`/manga`, type Manga, folder watching on**. Folder watching also has a
  **server-wide** switch (Settings > General, `ServerSetting` key 17), off by default, and the
  per-library flag does nothing without it. It was off until 2026-09-23. It mounts `MANGA_ROOT/mangas`, so the
  `<source>` folder is the first level. The series name comes from ComicInfo, so the same title
  from two sources ends up as two series only when the names differ (e.g. "One Piece" vs
  "One Piece (Official Colored)").
- Chapters with no volume number (all of MANGA Plus) are listed under volume `-100000`, which
  Kavita shows as Specials/loose chapters. Nothing is wrong.
- With both switches on, a finished Suwayomi download schedules `ScanFolder` for its source
  folder within seconds on the mini PC, and Kavita batches it: the chapters appeared about 6
  minutes later, with no manual scan. On the Mac nothing fired, but the server-wide switch was
  off there too, so Docker Desktop was never actually tested.
- API: `/api/Plugin/authenticate?apiKey=…` returned no token on this version, so there's no
  working scripted Kavita access yet. Its config lives in `kavita.db` in WAL mode, so a copy for
  inspection needs `kavita.db-wal` too, or it looks empty. The DB holds the user's API key and
  password hash, so delete any copy afterwards.

## Yomu (`web/`): the reading front end

Kavita's own UI is a full admin console. Yomu is the reader people actually use: sign in, a
shelf, a series page, a reader, and one **Scan library** button (admins only). It talks to
Kavita's REST API and nothing else, so Kavita stays the source of truth for users, progress and
covers. It's our own code, and nothing is copied from Kavita's GPL web UI.

```
web/
  src/lib/kavita/   client.ts (fetch + JWT refresh + image key), auth.tsx, queries.ts, images.ts, types.ts
  src/lib/format.ts chapter names, genre filtering, summary cleanup
  src/components/   ui.tsx (Wordmark, Bubble, Button, Pill, Cover, ProgressLine), Header, ScanButton
  src/routes/       Login, Home, Series, Reader
  src/index.css     every colour and font; the speech bubble and screentone utilities
```

- **Public API surface.** `web/nginx.conf` forwards only the routes the reader calls
  (`account/login`, `account/refresh-token`, `series/…`, `reader/…`, `image/…-cover`,
  `library/scan-all`) and 404s the rest of `/api`. A new Kavita call in `src/lib/kavita/` needs
  its route added to the `$kavita_route` map, or it works in `bun run dev` and 404s in production.
  Raw paths with `..` or encoded slashes get a 400, and sign-in is rate-limited to 5 per minute
  per visitor (`CF-Connecting-IP`).
- **Run:** `cd web && bun install && bun run dev`, which serves <http://localhost:4571>. Vite proxies
  `/api` to `KAVITA_URL` (default `http://localhost:5001`). Verify with `bun run build` and
  `bun run lint`. There are no tests.
- **Auth:** `POST /api/account/login` returns a JWT (sent as `Bearer`) and `authKeys`. `<img>` tags
  can't send headers, so covers and pages use the `image-only` key as `?apiKey=`. A 401 triggers
  one `account/refresh-token`, and after that the user is signed out.
- **Kavita 0.9.1.4 specifics:**
  - `series-detail` puts every manga chapter in `chapters`, and also repeats them under
    `volumes`, so the list is deduplicated.
  - `continue-point` returns the earliest unread chapter, so resuming picks the most recently
    touched half-read chapter first (`resumeChapter`).
  - Progress `pageNum` is the 0-based current page, and sending `pages` marks the chapter read.
  - `library/scan-all` is admin-only and asynchronous, so the button polls `series/all-v2` until
    the page counts settle.
- **Design:** kraft paper (`--paper #f3e6d3`) and chocolate ink (`--ink #3a1d16`), Fraunces (SOFT
  axis) for titles, Literata for text. The app speaks in speech bubbles (greeting, scan results,
  end of chapter), and screentone dots appear only behind the hero. The reader is night-dark,
  with right-to-left, left-to-right or scroll chosen per series and remembered on the device.

### Checking it in a browser

`agent-browser` screenshots work, but the tool sometimes relaunches its browser, and the new
profile has no `localStorage`, so every page redirects to `/login`. That's the test browser,
not the app. Sign in again before each shot. Getting a session without typing a password means
reading an auth key out of `kavita.db`. Ask the user before doing that, and never print the key.

## Sources: what works

| Source | Status |
|---|---|
| MangaDex | Fine for unlicensed titles. **Licensed titles are DMCA'd**: listed, but `api.mangadex.org/at-home/server/<id>` returns 404, and the download fails 5 times and ends in `ERROR`. The B&W One Piece is like this (manga id 81, still in the Suwayomi Library, safe to remove). |
| MANGA Plus by SHUEISHA | Official and legal. Only the first 3 and latest 3 chapters of each series. Pages are encrypted, so each chapter takes minutes. One Piece is manga id 115. |
| MangaDex "One Piece (Official Colored)" | Manga id 87, ch. 1 to 763 (vol. 76), pages still served. Some chapters are uploaded twice (PowerManga + GTScans), so filter to one scanlator before a bulk download. Roughly 20 to 40 GB for the whole run (estimate). |
| MangaDex "One Piece (Fan Colored)" | Empty, `No chapters found`. |

Worth installing: Webtoons.com (nearly all free, official), VIZ and Comikey (official, free
chapters). Italian is not wanted.
