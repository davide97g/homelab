# CLAUDE.md — mediarr dashboard

> **Retired on 2026-09-20. Nothing here runs any more.**
>
> The pipeline graph lives on the hub, at `monitoring.davideghiotto.it/media`
> — see [`../hub`](../hub). The container is gone from the box,
> `mediarr.davideghiotto.it` no longer resolves, and its Cloudflare Access
> application and tunnel ingress rule have been deleted. `~/mediarr-dash` on the
> box is still there and is now just files.
>
> This tree is kept as a reference, not as a thing to run: its collectors are
> where the hub's ported ones came from, and `CLAUDE.md` holds notes on what the
> upstream APIs actually do that are still true. Two of them are **not** true in
> here any more, and both were fixed in the port: Jellyfin 12.1 answers 401 to
> the `X-Emby-Token` header this app still sends, and the busy-edge rule reads
> stats back out of their rendered strings by English label.

A single page that draws the homelab media pipeline as a graph: one node per
service, edges in the order a request actually travels, live numbers on each
card. Password protected, one user, runs on the box.

Read [`README.md`](README.md) for how to deploy and operate it. This file is the
part that is not obvious from the code: why it is shaped this way, what the
upstream APIs actually do as opposed to what their docs say, and which small
decisions will bite if they are undone.

`../media-pipeline.md` is the companion document — it explains the pipeline
itself, which is what this dashboard visualises.

## Where it runs

| | |
|---|---|
| Box | `ssh homelab` — `debian` on the tailnet, `debian.local` on the LAN, Debian 13 |
| Source on box | `/home/davide/mediarr-dash` |
| Container | `mediarr-dash`, image `mediarr-dash:latest`, built on the box |
| Published | `:3002` → container `:8080` |
| Secrets | `/home/davide/mediarr-dash/.env`, mode 600, never in git |
| Public | `https://mediarr.davideghiotto.it` via the host's `cloudflared.service` |

Nothing about this project runs on a laptop except the editor. The image is
built over SSH because there is no registry, and Dokploy's Raw compose provider
can only name an image, not build one.

## Shape

```
browser ──► :3002 ──► Hono (server/) ──┬─► Jellyseerr  :5055   /api/v1
                │                      ├─► Radarr      :7878   /api/v3
                │                      ├─► Sonarr      :8989   /api/v3
                │                      ├─► Prowlarr    :9696   /api/v1
                │                      ├─► qBittorrent :8080   /api/v2
                │                      ├─► Bazarr      :6767   /api
                │                      ├─► Jellyfin    :8096   REST
                │                      └─► Prometheus  :9090   (container name)
                └─► the built frontend, served from server/dist/public
```

**One container, one origin, one port.** The server serves the API and the page,
so there is no CORS to configure, the session cookie is same-origin by
construction, and the Cloudflare Tunnel has exactly one thing to point at. Do
not split these into two containers without a reason; it buys nothing here and
costs all three of those.

The browser never talks to a media service. It only ever sees `/api/overview`.
API keys stay server-side.

### The one endpoint

`GET /api/overview` returns everything the page draws, in one payload: host
metrics, an array of service snapshots, the edge list, and the node positions.
The frontend polls it every 5 s and pauses while the tab is hidden.

Edges and positions come from the *server* (`server/src/overview.ts`) rather
than being hard-coded in the frontend, so the pipeline's shape is described once
and both halves agree.

## Directory map

| Path | What |
|---|---|
| `server/src/config.ts` | Every address and key, read once at boot. Defaults are the box's published LAN ports. |
| `server/src/http.ts` | `getJson`, `request`, `soft`. Hard timeout on everything. |
| `server/src/cache.ts` | TTL cache that also shares an in-flight fetch. |
| `server/src/auth.ts` | Single password, HMAC-signed cookie, no session store. |
| `server/src/overview.ts` | Assembles the payload. **Edges and positions live here.** |
| `server/src/services/*.ts` | One collector per service. |
| `server/src/services/types.ts` | The `Snapshot` / `Stat` / `Activity` contract. |
| `frontend/src/lib/api.ts` | The same contract, hand-mirrored. See below. |
| `frontend/src/components/service-node.tsx` | The node card. Renders stats generically. |
| `frontend/src/components/host-node.tsx` | The host panel with the gauges. |
| `frontend/src/components/pipeline-graph.tsx` | React Flow canvas, edge styling, busy detection. |
| `frontend/src/components/detail-drawer.tsx` | Right panel: the lists behind the numbers. |
| `scripts/collect-env.sh` | Writes the box's `.env` from the running containers. |
| `deploy.py` | tar up, build on the box, deploy. |

## Conventions that matter

### Adding a metric is a one-file change

The node card renders `snapshot.stats` generically — label, value, optional hint,
optional tone, optional progress bar. **Push a `Stat` into a collector and it
appears on screen. Do not add a matching UI branch.** If a metric seems to need
one, the `Stat` shape is probably the thing to extend, for every service at once.

Same for `activity` — the drawer renders that list generically too.

### The types are mirrored by hand

`server/src/services/types.ts` and `frontend/src/lib/api.ts` describe the same
objects and are two separate files. There is no codegen and no shared package.
That is a deliberate trade — a workspace-shared types package for seven types
was not worth the build complexity — but it means **changing one requires
changing the other**. Nothing will catch it if you don't; the payload is JSON.

### Status has four states, and `warn` is not `down`

| State | Means |
|---|---|
| `up` | answered, nothing wrong |
| `warn` | answered, and told us something is wrong — a Radarr health error, a throttled Bazarr provider |
| `down` | did not answer |
| `unconfigured` | no key or credential set for it |

Keeping `warn` separate from `down` is the whole point of the colour on the node
dot: a degraded service still works, an unreachable one does not.

### Optional calls use `soft()`

A collector fetches its identity endpoint directly — if that throws, the service
is `down` and there is nothing to show. Everything after that is wrapped in
`soft()`, which resolves to `null` instead of throwing. **One missing endpoint
must not blank out a whole node.**

### Cache TTLs are deliberate

| Key | TTL | Why |
|---|---|---|
| `services`, `host` | 4 s | The page polls at 5 s and several tabs may be open. The cache also shares an in-flight refresh, so N tabs cause one upstream fetch, not N. |
| `radarr:library`, `sonarr:library` | 60 s | The only expensive calls here — see the Radarr note below. |
| Jellyseerr TMDB titles | forever, in-process | A film's title does not change. |

### Adding a node

Four places: a collector in `server/src/services/`, a call in `collectAll()`, an
entry in `EDGES` and `POSITIONS`, and an icon in the `ICONS` map in
`service-node.tsx`. Positions are hand-placed on purpose — auto-layout would
scramble the left-to-right reading that *is* the information.

## Upstream APIs: what is actually true

Every item here cost time to find. None of it is in the obvious documentation.

### qBittorrent (5.2.3)

- **Login answers `204 No Content` with an empty body.** Older builds answered
  `200 "Ok."`. A wrong password is `200 "Fails."`. All three are `res.ok`, so
  the status code tells you nothing.
- **The session cookie is `QBT_SID_<port>`** — `QBT_SID_8080` here — not `SID`.
  The code passes through whatever cookie pairs come back rather than matching a
  name, because this has already changed once.
- **"Bypass authentication for clients on localhost" does not cover us.** The
  dashboard reaches qBittorrent from another container, so it needs a real login.
  A 403 means credentials. The alternative is adding the Docker bridge to
  `Options → Web UI → Bypass authentication for clients in whitelisted subnets`.
- **Host-header validation** rejects a request whose `Host` is a container name,
  which is one reason every service default is an IP rather than `qbittorrent:8080`.
- `Referer` is sent on every call; qBittorrent rejects a cross-origin-looking POST without it.

### Jellyseerr / Seerr (3.4.1)

Upstream rebranded Jellyseerr to **Seerr** at v3.0.0 and moved to
`ghcr.io/seerr-team/seerr`. The box runs `v3.4.1` — note the tag carries the
`v`, `3.4.1` is not a valid tag and pulls `manifest unknown`. The image runs as
the `node` user rather than root, so the config volume is chowned `1000:1000`
and `init: true` is set in `~/mediarr/compose.yml`. The v3 migration is one-way:
3.4.1 rewrites the database and 2.7.3 will not read it back.

Everything below still held after the upgrade — the `/api/v1` surface the
collector uses is unchanged, and so is `X-Api-Key`. The names here are still
`jellyseerr` throughout this repo (node id, env vars, collector filename); only
the upstream product was renamed.

One v3 addition: `/api/v1/status` omits `updateAvailable` entirely when version
checking is switched off, rather than returning `false`. The collector already
guards with `!= null`, so the flag simply disappears from the card.

- **`/api/v1/request/count` reports `available: 0`** even with plenty of
  available media — it counts *requests*, and a request stops counting once its
  media is done. Availability comes from `/api/v1/media?take=1&filter=available`
  and its `pageInfo.results` instead. `filter=all` gives the denominator.
- **A request carries no title**, only a `tmdbId`. Jellyseerr's own UI resolves
  those against TMDB per item; we go through its TMDB proxy
  (`/api/v1/movie/{id}`, `/api/v1/tv/{id}`) so no second API key is needed, and
  cache the answers for the process lifetime.
- Request status and media status are separate integers on the wire. See the two
  maps at the top of `jellyseerr.ts`.

### Bazarr (1.6.0)

- **`config.yaml` contains six `^  apikey:` lines** — Bazarr's own plus Radarr,
  Sonarr and several providers. A plain `sed -n 's/^  apikey: //p'` concatenates
  all of them and produces a 102-character string that is not a key. The one that
  matters is inside the `auth:` block; `collect-env.sh` matches the block.
  *(The same bad command is in `../media-pipeline.md`, left as found.)*
- **A healthy SignalR feed reads `"LIVE"`**, not `"connected"`. Both are accepted.
- **`/api/providers` lists only the providers currently throttled.** An empty
  list is the healthy case, not a missing answer.
- The `providers` count in `/api/badges` is *not* the throttled count.

### Radarr / Sonarr (v3) and Prowlarr (v1)

- **Prowlarr is `/api/v1`, the other two are `/api/v3`.** Easy to get wrong since
  they are otherwise the same API.
- **Neither Radarr nor Sonarr has a count endpoint.** Getting "how many movies"
  means fetching the whole collection — hence the 60 s cache on exactly those two
  calls. If the library grows a lot, this is the thing to revisit first.
- Health entries are the apps telling on themselves; `error` is worth a red node,
  `warning` (an indexer that failed once, an update available) is not.

### Jellyfin (10.11.11)

- The API key cannot be read out of the container — no `sqlite3` in the image and
  the key lives in `jellyfin.db`. It has to come from Dashboard → API Keys → +.
- `PlayMethod` containing `Transcode` is the expensive case and is called out
  separately from plain playback. `TranscodeReasons` explains why, and is worth
  surfacing — see the PGS burn-in trap in `../media-pipeline.md`.
- There are **two Jellyfin servers on this LAN**. The homelab one
  (`d412939b4e0c48b9abed2887b9911ef1`) is the real one. Check this first if
  numbers look wrong.

### Prometheus / cAdvisor

- **Prometheus is not published on the LAN.** It is reachable only by container
  name from inside the monitoring network, which is why `docker-compose.yml`
  joins one external network.
- **That network's name carries Dokploy's app slug** —
  `monitoring-frontend-fnhjyi_monitoring` today. Renaming the monitoring app in
  Dokploy breaks the host card. `docker network ls` shows the current name; set
  `MONITORING_NETWORK` if it moves.
- **`node_exporter` *is* on the LAN at `:9100`** (it runs `network_mode: host`).
  If the network name ever becomes a recurring problem, parsing that directly is
  the fallback — it costs the cAdvisor per-container metrics and the recorded
  power rule, both of which only exist inside Prometheus.
- **Watts are modelled, not measured.** `homelab:power_wall_watts:estimate` is
  the amdgpu rail plus a fixed platform offset. Always label it `est.`

## Frontend gotchas

- **Radix `ScrollArea` gives its viewport's child `display: table`**, which sizes
  to content and silently defeats `truncate` on everything inside. The fix is the
  `[&>div]:!block` on the Viewport in `ui/scroll-area.tsx`. Do not remove it —
  the symptom is long torrent names running off the drawer, with no error.
- **The feedback edge needs its own handles.** Jellyfin → Jellyseerr runs right
  to left, against the pipeline. Without the `id="under"` handles on the bottom
  of each service node it loops back across every card and off-canvas. It is a
  `smoothstep` edge through those handles.
- **An edge animates only when work is moving along it.** `busyEdges()` in
  `pipeline-graph.tsx` reads numbers back off the snapshots to decide. A quiet
  pipeline should look quiet — if everything is always dashed, that check broke.
- **The theme is copied verbatim from tweakcn** ("ESLinks",
  `https://tweakcn.com/r/themes/cmmaobxtw000004l7fivrgmwy`) into
  `frontend/src/index.css`, so it stays diffable against its source. Do not
  hand-tune the colour tokens; change the theme upstream and re-copy. The one
  colour written out by hand is amber, which has no slot in the shadcn palette.
- **Dark is hard-coded** — `<html class="dark">` in `index.html`. The light set is
  kept anyway so the shadcn components behave if that ever changes.
- **pnpm 11 keeps build permissions in `pnpm-workspace.yaml`**, not `package.json`.
  `allowBuilds: esbuild: true` is required or Vite will not start, and pnpm
  rewrites the file if the key is missing.

## The tunnel

The box already runs `cloudflared` as a **host systemd service**
(`/etc/systemd/system/cloudflared.service`), started with `--token-file
/etc/cloudflared/token`. A token-run tunnel takes its ingress from the Zero
Trust dashboard, **not** from a local `config.yml` — there is no ingress file on
the box to edit, and `/etc/cloudflared/` holds only the token. Add or change a
route in Zero Trust → Networks → Tunnels → *(this tunnel)* → Public Hostname.

Because `cloudflared` is on the host rather than in a container, the route's
origin is `http://localhost:3002` — the published port, no Docker networking
involved.

A Cloudflare Access self-hosted application sits in front of the hostname —
team domain `sooshi.cloudflareaccess.com`. Access is the internet-sized gate;
the dashboard's own password is the second layer behind it.

Three consequences worth knowing:

- **`COOKIE_SECURE=true` is set, so the LAN address can no longer log in.** A
  browser will not store a `Secure` cookie received over plain HTTP, so
  `http://debian:3002` shows the login form and never gets past it. Use
  the public hostname. This is the trade the flag exists to make; `:3002` stays
  published for `curl` on the box and for the health check.
- **The `*_PUBLIC_URL` values are the node links, and nothing validates them.**
  A wrong hostname there is a dead link on a card, with no error anywhere.
- **Access gates `/healthz` too**, so nothing outside can probe it — every path
  on the hostname answers `302` to the Access login until a session exists. The
  container's own health check goes to `127.0.0.1:8080` and is unaffected. If an
  external uptime monitor is ever wanted, the way in is a second Access
  application scoped to the `/healthz` path with action Bypass.

## Secrets

**Never pull an API key into an agent session.** The keys are readable out of the
containers, which makes it tempting; don't. `collect-env.sh` runs *on the box*,
reads them there, and writes `.env` there. Nothing transits a laptop, this repo,
or Dokploy's environment tab.

```sh
ssh -t homelab 'bash ~/mediarr-dash/scripts/collect-env.sh'
```

Interactive: keeps existing values, asks for the three it cannot read (Jellyfin
key, qBittorrent login, the dashboard password). `NONINTERACTIVE=1` asks nothing
and only refreshes the container-readable keys — the right form after rotating
an \*arr key, and the only form that works without a terminal.

`SESSION_SECRET` is preserved across runs on purpose: rotating it logs every
browser out.

## Commands

```sh
pnpm install
pnpm dev          # vite :5173 proxying /api to the server on :8080
pnpm build
pnpm typecheck    # both packages

./deploy.py              # tar up, build on the box, deploy
./deploy.py --no-build   # redeploy the image already there
./deploy.py --logs       # follow the container log
```

`deploy.py` uses Dokploy when `.dokploy.env` names a compose app and falls back
to plain `docker compose` on the box when it does not — which is also what
happens if Dokploy is down.

**The box has no `rsync`.** Source goes up as a tar stream over the SSH
connection. Don't reach for rsync in a script here.

## Verifying a change against real data

The services are unauthenticated on the LAN but the dashboard is not, so the
honest end-to-end check runs on the box and reads the password out of `.env`
there:

```sh
ssh homelab 'cd ~/mediarr-dash; P=$(sed -n "s/^DASHBOARD_PASSWORD=//p" .env);
  curl -s -o /dev/null -c /tmp/c -X POST -H "content-type: application/json" \
    --data-binary "{\"password\":\"$P\"}" http://127.0.0.1:3002/api/login;
  curl -s -b /tmp/c http://127.0.0.1:3002/api/overview | python3 -m json.tool | head -60;
  rm -f /tmp/c'
```

For UI work, a fixture-serving mock beats the real thing: it needs no credentials
and can hold states that are hard to produce on demand (a failing import, a
transcoding session, a service down). Point Vite at it with `API_TARGET`.

## Deliberately not done

- **No WebSocket or SSE.** Polling at 5 s is enough for numbers that are
  themselves several seconds old, and it survives a tunnel and a sleeping laptop
  without reconnect logic.
- **No historical charts.** Grafana already does that, and the host card links to
  it. This page answers "what is happening now".
- **No write actions.** Nothing here retries a download or approves a request;
  every node links to the service that can. Read-only keeps the auth story small.
