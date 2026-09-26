# Media pipeline

How a request becomes a file with subtitles on it, a status in Jellyseerr, and a message in
Telegram. Written 2026-09-13, after the chain was finished and debugged end to end.

The containers themselves live in [`mediarr`](../stacks/mediarr) — this is the part that is not
obvious from `compose.yml`: what talks to what, why each piece is there, and the four things
that were quietly broken.

```
                                              ProtonVPN (Zürich)
                                                   ^  peers and trackers
                                                   |  see only this exit
                                          +--------+--------+
                                          | gluetun tunnel  |
Jellyseerr  ->  Radarr / Sonarr  ->  Prowlarr  ->  qBittorrent
  (asks)          (decides)          (searches)    (downloads)
                      |                                |
                      |  hardlink into library/        |
                      +--------------------------------+
                                     |
                      Bazarr  <------+------>  Jellyfin
                   (fetches .srt)           (scans, plays)
                                     |
                      Jellyseerr marks Available
                                     |
                              Telegram group
```

| Service | Port | Role |
|---|---|---|
| Jellyseerr | 5055 | Requests, availability, notifications |
| Radarr / Sonarr | 7878 / 8989 | Decide, grab, file |
| Prowlarr | 9696 | Indexers, synced to both |
| qBittorrent | 8080 | Transfer, inside gluetun's network namespace |
| gluetun | 172.17.0.1:8001 | ProtonVPN WireGuard tunnel, the kill switch, control API for the hub |
| Bazarr | 6767 | Subtitles |
| Jellyfin | 8096 | Library and playback |

Only qBittorrent's traffic goes through the VPN. The indexer searches, Jellyfin and everything
else stay on the home line. How the tunnel, port forwarding and kill switch work is in
[`stacks/mediarr/README.md`](../stacks/mediarr/README.md#torrents-go-through-a-vpn).

## One Jellyfin, on the NAS

There used to be two Jellyfins on this LAN and they shared nothing, which broke everything
downstream: requests stayed *Requested* forever even for films already in the library, because
Jellyseerr was asking the wrong server whether the file existed.

That is settled now — there is one Jellyfin, `nasilario` (`c5dcde12661c4668acd640f2499b084f`),
on the NAS, and it is the one `cinema.davideghiotto.it` serves. The mini PC's own Jellyfin was
removed; `streaming.davideghiotto.it`, which served it, is retired.

### The NAS is not on this LAN

It reports `192.168.15.140/24`, but that is a different physical network that happens to use the
same subnet. Mini PC to NAS over `192.168.15.x` is `No route to host`; Tailscale
(`${NAS_TAILNET_IP}`) is the only path. Everything that crosses between the boxes goes through the
`nas` SSH alias or that address.

So the library is **copied, not mounted**: `~/xfer-nas-auto.sh` on a ten-minute user timer hands
each new folder to `~/xfer-nas.sh`, which sends it resumably and verifies it by md5 into
`/volume1/test/{movies,tv}`. Nothing is deleted on the mini PC, so a finished download keeps
seeding there while it plays from the NAS. The practical consequence: a request is *Processing*
from the moment it imports until the copy lands, not *Available*.

### Jellyfin 12 speaks a different header

The NAS runs Jellyfin **12.1.0**, which dropped the Emby-era header names. Jellyseerr still
sends `X-Emby-Authorization`, and 12 answers 401 to it — verified both ways:

| | `X-Emby-Authorization` | `Authorization: MediaBrowser Token=…` |
|---|---|---|
| Jellyfin 10.11.11 | 200 | 200 |
| Jellyfin 12.1.0 | **401** | 200 |

So Jellyseerr cannot talk to that server directly at all. `jellyfin-proxy` in the mediarr stack
is an nginx that copies the header across and forwards to the NAS. It listens on 8096, the port
the old local Jellyfin held, so hub, mediarr-dash and jarvis keep working unchanged.

If availability ever goes stale, check what Jellyseerr is pointed at:

```sh
ssh homelab 'docker exec jellyseerr cat /app/config/settings.json' | python3 -c \
  'import json,sys; j=json.load(sys.stdin)["jellyfin"]; print(j["ip"], j["port"], j["serverId"])'
```

It should print `192.168.15.126 8096 c5dcde12…`.

### Repointing it

[`jellyseerr-repoint.py`](../stacks/mediarr/scripts/jellyseerr-repoint.py) takes the key and the server
URL, and does it in two halves because a Jellyseerr account is keyed by the Jellyfin user id it
was created from, and those ids differ per server:

1. `settings.json` — connection, `serverId`, and the library ids fetched from the new server.
2. `db.sqlite3` — the `user` row's `jellyfinUserId`, matched by username.

```sh
cd stacks/mediarr && ./scripts/on-box.sh jellyseerr-repoint.py <key> http://192.168.15.126:8096
```

Two traps it walks into, both hit on 2026-09-19:

**A library with no items has no view.** The script reads libraries from `/Users/<admin>/Views`,
and Jellyfin does not list a library it has never scanned. A freshly added `Shows` folder is
silently missing from the repoint. Scan the NAS Jellyfin first, then run it.

**It copies `db.sqlite3` without the `-wal`.** Jellyseerr had been running for days without a
checkpoint: the main file was stale and 4 MB of live schema and data sat in the sidecar. Copying
the main file out, editing it and copying it back leaves the sidecar behind. Nothing was lost
here, but back up all three files before running it.

## Subtitles

### Why the Blu-ray tracks were unusable

A remux carries its subtitles as **PGS** — `hdmv_pgs_subtitle`, a stream of bitmap images
lifted off the disc. They are pictures of text, not text. No browser can draw them, so Jellyfin
can only show them by *burning them into the video*, which means transcoding the whole film.
On a 4K HEVC remux that is a heavy, pointless job for something a 100 KB `.srt` does for free.

That is the whole reason Bazarr is in the stack: it fetches **text** subtitles and drops them
next to the video as sidecar files, which every client renders directly with no transcode.

```
Avengers - Endgame (2019)/
  Avengers - Endgame (2019).mkv        <- video, embedded PGS
  Avengers - Endgame (2019).it.srt     <- what Bazarr fetched, what actually plays
```

### Why they also said "Undefined"

The library file was a raw `00055.m2ts` lifted straight out of a `BDMV/STREAM/` folder. The
MPEG transport stream format has **nowhere to put a language tag** — on a real Blu-ray the
languages live in a separate index file, `BDMV/CLIPINF/00055.clpi`, which Jellyfin never reads.
Hence five identical `Undefined - PGSSUB` entries in the picker.

`mkvpropedit` cannot fix that; there is no metadata field to edit. The file has to become a
Matroska file first. The languages were read out of the `.clpi` by hand — the stream entries
are plain 3-byte ASCII codes next to each PID:

| PID | Track | Language |
|---|---|---|
| `0x1100` | TrueHD 7.1 | eng |
| `0x1101` | AC3 2.0 | eng |
| `0x1102` | AC3 5.1 | fra |
| `0x1103` | E-AC3 7.1 | spa |
| `0x12a0`–`0x12a4` | PGS | eng, fra, spa, fra, spa |

then remuxed with `-c copy` — stream copy, no re-encode, no quality loss, ~5 minutes for 64 GB:

```sh
ssh homelab 'docker run --rm -u 1000:1000 -v /home/davide/media:/data \
  --entrypoint /usr/lib/jellyfin-ffmpeg/ffmpeg jellyfin/jellyfin:10.11.11 \
  -i "/data/.../00055.m2ts" -map 0:0 -map 0:1 -map 0:3 -map 0:4 -map 0:5 -map 0:6 ... -c copy \
  -metadata:s:a:0 language=eng -metadata:s:s:0 language=eng ... "/data/.../Movie (Year).mkv"'
```

Three things worth remembering from that:

- **A throwaway container, not `jellyfin`.** The jellyfin service mounts `/data` **read-only**
  on purpose — a media server has no business writing to the library. Running ffmpeg inside it
  fails with `Read-only file system`.
- **Skip the AC3 core.** ffmpeg exposes a TrueHD track twice, once as `truehd` and once as the
  `ac3` core hiding on the same PID (`0x1100`). Mapping both duplicates the audio.
- **The old file was a hardlink.** Library and torrent were the same inode, so deleting the
  library copy left qBittorrent seeding happily from `torrents/`. Check before deleting
  anything under `library/`: `stat -c '%i %h %n' file` — two links means the bytes survive.

### How Bazarr is wired

| Setting | Value | Why |
|---|---|---|
| Radarr / Sonarr | `radarr:7878`, `sonarr:8989` | Container names, shared network |
| Language profile | `Italiano + English` (`it`, `en`), default for new movies and series | |
| Providers | `opensubtitlescom`, `podnapisi`, `yifysubtitles` | |
| Trigger | Radarr/Sonarr SignalR feed | Near-instant on import, not a poll |
| Sweep for missing | every 6 h | Catches what was not available at import time |
| Upgrade existing | every 12 h | Better match appears later |
| Mount | same `/data` as the \*arrs | Paths in the Radarr API match what Bazarr opens |

The same-mount rule matters as much here as it does for hardlinks: Bazarr is told a path by
Radarr and then opens it itself. Different mount points would mean a path-mapping table to
maintain, and `Movie file not found. Path mapping issue?` on every search.

### Four traps, all hit

**Language profile items need `audio_only_include`.** Bazarr 1.6 reads that key
unconditionally in its indexer. A profile written through the API without it throws
`KeyError: 'audio_only_include'` on *every* scan — and because the scan dies, missing
subtitles silently report as empty, so everything looks fine while nothing is ever fetched.
A profile item needs all of: `language`, `audio_exclude`, `audio_only_include`, `hi`, `forced`.

**opensubtitles.com is not opensubtitles.org.** Separate sites, separate registrations. An
account on the old `.org` gives `AuthenticationError: 'Login failed'` against the `.com`
provider, and Bazarr then throttles it out for 12 hours.

**subf2m needs a user agent.** Without one it throttles itself on the first search
(`ConfigurationError: 'User-agent config missing'`). Dropped rather than left in as a
permanently dead provider.

**A throttled provider stays throttled** even after the credentials are fixed. Clear it instead
of waiting the 12 hours out:

```sh
curl -s -X POST -H "X-API-KEY: $(ssh homelab 'docker exec bazarr sed -n "s/^  apikey: //p" /config/config/config.yaml')" \
  -d action=reset http://debian:6767/api/providers
```

## Playback, HDR and why films looked grey

A 4K HDR remux played back washed out — flat, grey, no contrast — but only when Jellyfin
transcoded. Direct play looked right.

### What the filter chain was doing

Jellyfin was not tone mapping. It relabelled the PQ video as SDR and encoded the values
untouched:

```
setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709,
hwmap=derive_device=drm,format=drm_prime,
libplacebo=upscaler=none:downscaler=none:format=bgra
```

The source is `bt2020nc / smpte2084 / Main 10`. Telling a TV that PQ data is bt709 and leaving
the pixels alone *is* the grey look — an SDR curve applied to HDR values.

That `setparams` string comes from `GetOverwriteColorPropertiesParam(state, isTonemapAvailable)`
in `EncodingHelper.cs`, and it is a reliable tell: bt709 in, no tone mapping. Working output
carries the opposite tag plus the filter itself:

```
setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc,
... libplacebo=...:tonemapping=bt.2390:peak_detect=0:
    color_primaries=bt709:color_trc=bt709:colorspace=bt709
```

So the check on any day's sessions is just whether the word appears at all:

```sh
ssh homelab 'docker exec jellyfin grep -c tonemapping /config/log/log_'$(date +%Y%m%d)'.log'
```

### What has to be true for it to happen

The box takes the AMD VAAPI + Vulkan chain (`GetAmdVaapiFullVidFiltersPrefered`). Startup says
whether it qualifies:

```
VAAPI device "/dev/dri/renderD128" is AMD GPU
VAAPI device "/dev/dri/renderD128" supports Vulkan DRM modifier
VAAPI device "/dev/dri/renderD128" supports Vulkan DRM interop
```

Tone mapping on that chain then needs only three things — the **Enable tone mapping** toggle,
an HDR range, and 10-bit depth. Hardware decoding for the source codec must be ticked in
Dashboard → Playback as well, or the transcode never reaches this chain to begin with.

### Tone mapping is the consolation prize, not the fix

A tone-mapped transcode is watchable; it is still SDR h264 where the TV could have had the
original HDR. The transcode itself came from PGS burn-in — the same trap as above, hit on one
film for every session in a row. Two settings on the `davide` user stop that:

| Setting | Value | Why |
|---|---|---|
| `RememberSubtitleSelections` | `false` | One manual pick of an English PGS track was replayed into every later session |
| `SubtitleLanguagePreference` | `ita` | Was empty; matches what Bazarr actually fetches |
| `SubtitleMode` | `Default`, unchanged | External subs already win under it |

Automatic selection was never the problem.
`MediaStreamSelector.GetDefaultSubtitleStreamIndex` sorts `OrderByDescending(x => x.IsExternal)`
ahead of every other rule, so a sidecar `.srt` always beats an embedded PGS track. Only a manual
override could reach the PGS, and `RememberSubtitleSelections` made that override permanent.

`AllowHevcEncoding` is on now too, so an unavoidable transcode is not forced down to 8-bit
h264. Both changes went in through the API and applied live, no restart:

```sh
# read what the server currently thinks
curl -s -H "X-Emby-Token: $KEY" http://debian:8096/System/Configuration/encoding
curl -s -H "X-Emby-Token: $KEY" http://debian:8096/Users
```

A Jellyfin API key comes from Dashboard → API Keys → +. Writing either object back is the same
URL with `-X POST -H 'Content-Type: application/json'` and the whole modified object as the
body — Jellyfin replaces it wholesale, so GET, edit one field, POST it all back.

## Notifications

Jellyseerr posts to the **Jellyfin** Telegram group (chat `-5413534120`) through the
`davide_jelly_bot` bot, on **media available** and **download failed** (`types: 24` — a bitmask,
`MEDIA_AVAILABLE` 8 + `MEDIA_FAILED` 16).

Web push was the first choice and does not work here: browsers only allow the Push API in a
**secure context**, and Jellyseerr answers on plain HTTP over the LAN. Chrome will refuse to
subscribe, silently. It would become an option if Jellyseerr were put behind the Cloudflare
Tunnel with a real certificate. The agent is explicitly disabled so it does not sit there
looking configured while delivering nothing.

Two Telegram details that cost time:

- **The bot must be messaged first.** A chat id cannot be looked up; it is read back out of the
  bot's own update queue via `getUpdates`, which is empty until someone writes to the bot.
- **Group ids are negative, and the shape matters.** A plain group is `-5413534120`; a
  supergroup would be `-100…`. The id from the `web.telegram.org` URL is the real one — verify
  with `getChat` before saving, rather than guessing at the prefix.

[`jellyseerr-telegram.py`](../stacks/mediarr/scripts/jellyseerr-telegram.py) does all of it — resolves
the chat, sends a test, saves the agent, disables web push:

```sh
cd stacks/mediarr && ./scripts/on-box.sh jellyseerr-telegram.py <bot-token> [chat-id]
```

Without a chat id it picks up whoever last messaged the bot. With one, it targets that chat.

## Timing

Nothing here is instant, and the lag is mostly Jellyseerr's scan cadence.

| Step | When |
|---|---|
| Import → Bazarr searches | seconds (SignalR push) |
| File → Jellyfin library | next Jellyfin scan |
| Jellyfin → Jellyseerr *Available* | `jellyfin-recently-added-scan`, every 5 min |
| Full reconcile | `jellyfin-full-scan` 03:00, `availability-sync` 05:00 |
| Missing-subtitle sweep | every 6 h |

So a finished download shows up as Available, with a Telegram message, within about five
minutes.

## Running things by hand

Both APIs want their own key, and both keys live inside the containers. Reading them inline
keeps them out of shell history.

```sh
# Jellyseerr: force a full library scan now instead of waiting for 03:00
ssh homelab 'K=$(docker exec jellyseerr node -p "require(\"/app/config/settings.json\").main.apiKey"); \
  curl -s -X POST -H "X-Api-Key: $K" http://localhost:5055/api/v1/settings/jobs/jellyfin-full-scan/run'

# Bazarr: the key every call below needs
ssh homelab 'docker exec bazarr sed -n "s/^  apikey: //p" /config/config/config.yaml'

# rescan one movie's subtitles on disk, then search for what is missing
#   action = scan-disk | search-missing | search-wanted | sync
curl -X PATCH -H "X-API-KEY: <key>" -d 'radarrid=1&action=search-missing' \
  http://debian:6767/api/movies

# what does Bazarr think each movie has, and what is still missing?
curl -H "X-API-KEY: <key>" http://debian:6767/api/movies

# what would the providers actually return? (manual search, ignores scoring)
curl -H "X-API-KEY: <key>" 'http://debian:6767/api/providers/movies?radarrid=1'
```

The manual search is the useful diagnostic: it separates "no Italian subtitle exists for this
release" from "the provider is broken", which the automatic search cannot tell apart — it just
reports nothing found either way.

## Scripts

They live in [`mediarr/scripts/`](../stacks/mediarr/scripts) and run **on the box**, because they read
API keys out of the containers and call ports that are only published on the box's LAN
interface. `on-box.sh` pipes them over SSH, so the repo is the only copy.

| Command | Does |
|---|---|
| `./scripts/on-box.sh bazarr-setup.py` | Bazarr's \*arr links, language profile, providers |
| `./scripts/on-box.sh jellyseerr-repoint.py <jf-key>` | Move Jellyseerr to a different Jellyfin |
| `./scripts/on-box.sh jellyseerr-telegram.py <token> [chat]` | Wire the Telegram agent |

All three are safe to re-run; they write the same settings every time.

## Clearing a stuck download

Two showed up on 2026-09-19, and each needed a different move.

**`importBlocked`.** The message was *"Found matching movie via grab history, but release was
matched to movie by ID. Manual Import required."* The fix is the manual import API — fetch the
candidates for the download folder, then post a `ManualImport` command with the file, `movieId`,
quality and languages.

Two things to know before running it:

- **`importMode: "auto"` moved the file.** `copyUsingHardlinks` is on and both paths are on one
  filesystem, so a normal import hardlinks; a *manual* import with `auto` decided the download
  was finished and moved it instead, emptying the torrent folder and silently ending the seed.
  Pass `importMode: "copy"` for anything still seeding. To repair it afterwards, hardlink the
  library file back to the original torrent path — same inode, no disk cost:
  ```sh
  ln "library/movies/<Film (Year)>/<file>.mkv" "torrents/<release>/<original name>.mkv"
  ```
  The original name is the `outputPath` from the queue record, which can differ from the
  library name by more than the folder — this one had a stray space before `.mkv`.
- **Send the `downloadId` too.** Without it the file imports but the queue entry stays
  `importBlocked` forever, because nothing ties the import back to the download. Clear a stale
  one with `removeFromClient=false&blocklist=false&skipRedownload=true`, which leaves the
  torrent seeding.

**Paused at zero bytes.** Six days, no data, no seeders worth the name. Nothing to resume —
blocklist it and let Radarr look again:

```sh
curl -X DELETE -H "X-Api-Key: $R" \
  "http://debian:7878/api/v3/queue/<id>?removeFromClient=true&blocklist=true&skipRedownload=false"
```

`skipRedownload=false` is what makes Radarr search immediately, and the blocklist is what stops
it grabbing the same dead release again.

## Known, not acted on

- **The `.srt` files are not hardlinked.** Bazarr writes into `library/`, so subtitles are not
  part of the torrent and do not affect seeding. Fine, just worth knowing they vanish if the
  library file is re-imported.
- **Forced subtitle tracks are unmarked.** The Endgame remux carries two French and two Spanish
  PGS tracks; the second of each pair is almost certainly forced/narrative, but nothing in the
  `.clpi` says so, and confirming it means counting packets across 64 GB. They are tagged by
  language only.
- **Three library files have no sidecar subtitles.** `Princess Mononoke (1997)`,
  `Harry Potter and the Chamber of Secrets (2002)` and `Dune (2021)`. Turning subtitles on for
  any of them means PGS burn-in, which means a transcode and an SDR picture. Bazarr has not
  found Italian text subs for them yet.
- **Jellyfin's library scan is manual after a remux.** Its API needs a token, so a file swapped
  underneath it only appears after a scan from the dashboard or the next scheduled one.
- **Ports are unauthenticated on the LAN.** Bazarr is now one more of them. Same rule as the
  rest of the stack: do not forward it.
