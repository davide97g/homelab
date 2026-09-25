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

The mini PC (`debian`), since 2026-09-23, as its own compose project in `~/manga`. That folder
is a plain copy of `apps/manga` from the homelab monorepo, not a clone: the deploy below ships
the committed tree over ssh, the same way cinema, swarm and tv do.

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
# from the repo root: ship what is committed, then rebuild on the box
git archive HEAD:apps/manga | ssh homelab 'tar x -C ~/manga'
ssh homelab 'cd ~/manga && docker compose up -d --build'
```

Only committed files travel, so commit first. `tar x` overwrites and never deletes: `.env`,
`data/` and `work/` on the box are left alone, and a file removed here has to be removed there
by hand. `up -d` recreates only the services whose config changed, and the named volumes survive it.

**Cloudflare.** One ingress rule on the mini PC's tunnel, `manga.davideghiotto.it` ->
`http://localhost:4571`, before the catch-all, and a proxied CNAME to the tunnel. It's not behind
Access: Kavita's sign-in is the gate, and the nginx allowlist below is what keeps everything else
of Kavita off the internet. The calls are the ones in `../../docs/porting-to-homelab.md` § 5.

## Files

| | |
|---|---|
| `compose.yml` | the services, the named volumes, and the shared bind mount |
| `covers/covers.py` | the `covers` service: real series covers into Kavita, see § Series covers |
| `transcribe/` | chapter scripts: the `transcribe` pipeline (Mac) and `serve.py`, the `scripts` service; see § Scripts |
| `web/Dockerfile`, `web/nginx.conf` | Yomu's image: Bun build, nginx serving `dist/` and proxying `/api` and `/script` |
| `.env.example` | `MANGA_ROOT`, `SUWAYOMI_PORT`, `KAVITA_PORT`, `YOMU_PORT`, `TZ` |
| `.env` | per host, gitignored. Mini PC: `MANGA_ROOT=./data`, default ports. On a Mac, `KAVITA_PORT=5001` (AirPlay holds 5000) |
| `data/` | the downloads (`MANGA_ROOT`), gitignored. `data/scripts/` holds the chapter scripts |
| `work/` | gitignored scratch on the Mac: test CBZs and their scripts while trying the pipeline |

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

### Series covers (`covers/`)

Kavita makes a series cover from the first page of the first chapter it has: a MANGA Plus
opening spread, or a scanlator's credits page. The `covers` service (`manga-covers`) swaps in
the source's real cover art from Suwayomi. Every 10 minutes it:

1. saves Suwayomi's thumbnail as `cover.jpg` in each downloaded series' folder, if one isn't
   there yet;
2. uploads it through `POST /api/upload/series` for every Kavita series whose cover isn't
   locked, and locks it.

- **Why not just `cover.jpg`:** Kavita does read one, but only from the series' `folderPath`,
  which with Suwayomi's `<source>/<title>` layout is the source folder shared by every series in
  it. `refresh-metadata` and forced scans ignore a `cover.jpg` in the series folder.
- **Overrides:** a cover set by hand in Kavita is locked, and `covers` never touches a locked
  one. To redo one from Suwayomi, delete its `cover.jpg` and unlock the cover in Kavita.
- **Key:** it needs `KAVITA_API_KEY` in `.env` (admin auth key; the upload is admin-only).
  Without it, it only saves the files.
- **Caching:** Yomu's nginx sends `Cache-Control: no-cache` on cover routes, so browsers
  revalidate and a new cover shows at once. An unchanged cover costs a 304.

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
  src/lib/script/   the scripts service: types.ts, queries.ts (useChapterScript, useScriptSearch)
  src/routes/       Login, Home, Series, Reader, Search
  src/index.css     every colour and font; the speech bubble and screentone utilities
```

- **Public API surface.** `web/nginx.conf` forwards only the routes the reader calls
  (`account/login`, `account/refresh-token`, `series/…`, `reader/…`, `image/…-cover`,
  `library/scan-all`) and 404s the rest of `/api`. `/script/` goes to our `scripts` service, not
  Kavita, so that allowlist stays exactly Kavita's reader routes. A new Kavita call in `src/lib/kavita/` needs
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

## Scripts (`transcribe/`): who says what, on every page

Each chapter can get a **script**: every line of text on every page, in reading order, with its
speaker by name and what kind of text it is. Yomu shows it next to the page (the scroll button in
the reader, or `s`) and searches across every chapter at `/search`. Everything runs locally, and
nothing costs money.

```
CBZ ──> Magi v2 ──> magi.json ──> Qwen3-VL (Ollama) ──> refined.<vlm>.json ──> script.json + script.md
        panels, texts, reading       OCR fixes, speaker names,
        order, OCR, speaker links,   line types, per page, with
        characters named by the bank the previous page as context
```

- **Magi v2** ([ragavsachdeva/magiv2](https://huggingface.co/ragavsachdeva/magiv2), pinned
  revision, remote code) is a manga model: it reads right to left, links each bubble to its speaker
  through the tail, and names characters by matching them against a bank of reference crops.
  Licence: personal and non-commercial use. magiv3 was tried: similar OCR, three times slower, and
  no name bank.
- **Qwen3-VL 8B** through Ollama sees the colour page and Magi's lines and returns, per line, the
  corrected text (or nothing if the OCR was right), the speaker, and the type (`dialogue`,
  `thought`, `narration`, `caption`, `sfx`, `sign`). It may not reorder or invent lines. Qwen2.5-VL
  7B was tried: it dropped 96 of 562 lines in One Piece ch. 1 and named Zoro and Garp, who are not
  in it.
- A page the VLM can't answer for (it loops, or the JSON won't parse twice) keeps Magi's lines,
  marked `source: magi`. Laughter like "HA HA HA" x60 is collapsed before the VLM sees it, which
  is what made it loop.

**Speed** on the M1 Max: Magi about 5 s a page on MPS, the VLM about 20 s, so about 10 minutes
for a 25-page chapter.

**Run it (Mac).** `brew install uv ollama`, `ollama serve`, `ollama pull qwen3-vl:8b`, then from
`transcribe/`:

```sh
uv run transcribe --mangas ../data/mangas chapter "../data/mangas/<source>/<series>/<chapter>.cbz"
uv run transcribe --mangas ../data/mangas series "../data/mangas/<source>/<series>"
```

Outputs go to `<mangas>/../scripts/<source>/<series>/<cbz name>/`, the library's layout, outside
the folder Kavita watches. Each stage is cached there; `--force detect|refine` redoes one,
`--vlm <ollama model>` picks another model (cached per model), `--no-refine` stops at Magi.
To try it on a few chapters, copy them under `work/mangas/<source>/<series>/` and use
`--mangas ../work/mangas`.

### The character bank

Magi names a character only if the bank has them, and the bank is per series
(`scripts/<source>/<series>/bank/`). It comes from chapters already transcribed:

1. `uv run transcribe --mangas … bank "<series folder>"` writes `bank/review.yaml` and
   `bank/review.html`. Every line the VLM gave a confident name votes that name onto the character
   box Magi says spoke it, and per name the crops nearest that name's mean Magi embedding are kept.
   Frequent characters nobody named come after as `?` clusters. No model calls, a second or two.
2. Open `review.html`, and in `review.yaml` set `status: confirmed` (fixing `name` if needed), delete
   wrong crops from `crops`, or `status: ignore`. Same name, same character. Crops can be moved
   between entries.
3. `… bank "<series folder>" --apply` copies up to 5 crops per name into `bank/images/` and
   `bank.json`. The next `chapter`/`series` run sees the bank changed and redoes detect and refine.

Clustering first and asking the VLM to name each cluster was tried first: the clusters mixed
characters, and it called 34 of 40 "Luffy". The VLM names people well on a page, where it sees who
talks to whom, and badly from a grid of crops.

### Serving them (`scripts` service)

`transcribe/serve.py`, standard library only, like `covers`. It mounts `MANGA_ROOT/scripts`
read-only and has no host port: Yomu's nginx forwards `/script/` to it on the compose network.

| Route | |
|---|---|
| `GET /script/chapter/<kavita chapter id>` | that chapter's `script.json`, 404 if it has none |
| `GET /script/search?q=` | lines matching every word (the last as a prefix), text or speaker, 50 at most |
| `GET /script/health` | scripts and indexed lines |

- **No auth of its own.** Each request's `Authorization` (the reader's Kavita JWT) goes to Kavita:
  `GET /api/series/chapter` answers the chapter's file path, or 401. Search is filtered to the
  series `series/all-v2` shows that token. Kavita's `series/chapter` does not check library access
  on 0.9.1.4, so a signed-in user can read the script of any chapter id; everyone here sees the one
  library, so it does not matter yet.
- **Index:** SQLite FTS5 in `/tmp`, rebuilt when any `script.json` changes (checked every 10
  minutes). Mapping a file to its chapter id needs the admin `KAVITA_API_KEY` from `.env`; without
  it, chapter scripts work and search is off.
- **Dev:** `KAVITA_URL=http://debian:5000 SCRIPTS_DIR=work/scripts PORT=4572 python3 transcribe/serve.py`,
  and Vite proxies `/script` to `SCRIPTS_URL` (default `http://localhost:4572`).
- **Deploy:** transcribe on the Mac, then
  `rsync -a data/scripts/ homelab:~/manga/data/scripts/` (or from `work/scripts/`), and
  `mkdir -p ~/manga/data/scripts` on the box before the first `docker compose up -d`, or Docker
  creates it as root.

## Sources: what works

| Source | Status |
|---|---|
| MangaDex | Fine for unlicensed titles. **Licensed titles are DMCA'd**: listed, but `api.mangadex.org/at-home/server/<id>` returns 404, and the download fails 5 times and ends in `ERROR`. The B&W One Piece is like this (manga id 81, still in the Suwayomi Library, safe to remove). |
| MANGA Plus by SHUEISHA | Official and legal. Only the first 3 and latest 3 chapters of each series. Pages are encrypted, so each chapter takes minutes. One Piece is manga id 115. |
| MangaDex "One Piece (Official Colored)" | Manga id 87, ch. 1 to 763 (vol. 76), pages still served. Some chapters are uploaded twice (PowerManga + GTScans), so filter to one scanlator before a bulk download. Roughly 20 to 40 GB for the whole run (estimate). |
| MangaDex "One Piece (Fan Colored)" | Empty, `No chapters found`. |

Worth installing: Webtoons.com (nearly all free, official), VIZ and Comikey (official, free
chapters). Italian is not wanted.
