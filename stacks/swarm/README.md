# Swarm

A replacement WebUI for qBittorrent on the mini PC. Dark, desktop-first, built
around the two things this box is actually used for: watching what Sonarr and
Radarr queued, and deciding what to delete when the disk fills.

`http://debian:8080` — same address as before. qBittorrent serves these files
itself, so there is no extra container, port, hostname or login.

```
pnpm install
pnpm dev                  # localhost:5173, proxied to the real qBittorrent
QBIT_PASS=… ./deploy.py   # first time only: build, ship, switch qBittorrent to it
QBIT_PASS=… ./deploy.py --revert
```

**After the first time, push to `main`** — see [Deploying](../../README.md#deploying). Dokploy's
`swarm` app runs [`compose.yml`](compose.yml): one `swarm-build` container builds the UI from the
checkout, swaps it into `/home/davide/media/webui/public` with two renames, and exits. qBittorrent
serves the new files on the next page load; nothing restarts. An exited `swarm-build` is the
normal state.

## How it is served

qBittorrent has an "alternative WebUI" mode: point it at a folder and it serves
that instead of its built-in UI. Two preferences do it, and both are set by
`deploy.py` through the API:

```
alternative_webui_path    = /data/webui
alternative_webui_enabled = true
```

Files live at `/home/davide/media/webui/public` on the host. That location is
not arbitrary:

- `/config` is a **named Docker volume**, which would mean `docker cp` on every
  deploy. `/data` is already a bind mount of `/home/davide/media`, so a plain
  `rsync` works.
- The host user `davide` is uid 1000, the same uid the container runs as, so
  files land with the right ownership and no `chown` is needed.
- **The build must sit in a `public/` subdirectory.** qBittorrent serves
  `<root>/public`, not `<root>`. This is the layout VueTorrent ships and it is
  not documented anywhere obvious.

## Things that cost time, recorded so they cost it once

**`AlternativeUIEnabled` silently resets to false.** If the folder is wrong,
qBittorrent logs `Using custom WebUI. Location: …` immediately followed by
`Using built-in WebUI.`, sets the preference back to false, and keeps
`RootFolder`. The API will even report `true` for a moment first. Check the log,
not the preference.

**Set the path and the flag in separate calls, path first.** Sent together,
qBittorrent acts on the enable flag before the path is in place, finds nothing,
and turns itself off.

**Never tune qBittorrent by editing `qBittorrent.conf`.** It rewrites the file
about a minute after startup and discards hand-added keys. Use the API.

**Speed values are bytes per second** everywhere in the API, including the
config file. qBittorrent's own default alternative limits read back as `10240`,
which is its documented 10 KiB/s.

## API notes (qBittorrent 5.2.3, WebAPI 2.15.1)

- **`/torrents/stop` and `/torrents/start`.** `/pause` and `/resume` are 404 —
  v5 renamed them.
- **States are `stopped*`, never `paused*`.** `pausedDL` and `pausedUP` do not
  exist in the 5.2.3 binary. Do not restore them from 4.x documentation.
- **There is no `/torrents/peers`.** Peers come from
  `/sync/torrentPeers?hash=…&rid=0`.
- **Login answers 204**, not 200 with `Ok.`. The cookie is HttpOnly, so success
  is confirmed by a follow-up call, not by reading the cookie. qBittorrent bans
  the caller for an hour after 5 failures — never retry in a loop.
- **`eta` of `8640000` means "no idea"**, not a hundred days.
- **`torrents` is absent from `sync/maindata` when there are none**, rather than
  empty. `global_ratio` and the cache counters are JSON strings while everything
  around them is numeric.
- `rid` is echoed back to get deltas; a stale or bogus one just forces a fresh
  `full_update`, so the stream cannot drift.

## The CSP is the real constraint

qBittorrent sends `default-src 'self'` with `script-src 'self' 'unsafe-inline'`
and `img-src 'self' data:` on every response.

- **No CDN for anything.** Geist is self-hosted via `@fontsource-variable`
  rather than linked from Google Fonts the way hub and dashboard do.
- **No `unsafe-eval`**, so the Vite dev server cannot run from the box. Develop
  locally against the proxy.
- No `blob:` for images or workers.

## Development

`vite.config.ts` rewrites `Origin` and `Referer` on the dev proxy. Without that,
every call fails: qBittorrent answers a foreign `Origin` with 401 and a
mismatched `Host` with 403.

```
QBIT_TARGET=http://debian:8080 pnpm dev
```

## Design

The palette is a fifth one in this homelab on purpose — cinema owns red,
mediarr-dash blue, hub orange, tv cyan, and each surface should read as itself.
Jade `#3FCF8E` is the only action colour; amber and red are status signals, not
decoration. Tokens live in `frontend/src/styles/tokens.css` and follow
`cinema/docs/DESIGN.md`: space separates things rather than borders, facts are
text rather than chips, and numbers are tabular mono everywhere because a
dashboard's figures are read as a column.
