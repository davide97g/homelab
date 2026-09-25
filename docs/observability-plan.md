# Observability: where this got to, and what is left

Companion to [`README.md`](README.md) and [`media-pipeline.md`](media-pipeline.md). This one is
the running plan for logs, NAS monitoring and the hub at `monitoring.davideghiotto.it`, written so
someone picking it up cold — a person or a fresh agent — can continue without re-deriving
anything.

Started 2026-09-18, out of a question about temperature spikes on the Grafana dashboard that could
only be answered from metrics, because there were no logs in the stack at all.

---

## The two repos, and which is which

This trips people up, so it is first.

| Repo | Serves | Is |
|---|---|---|
| [`monitoring/`](monitoring) | `grafana.davideghiotto.it` | The **stack**: Prometheus, Grafana, Loki, Alloy, exporters. A Dokploy Raw compose app. |
| [`hub/`](hub) | `monitoring.davideghiotto.it` | The **reader**: a custom dashboard app. Stores nothing, collects nothing. |
| [`dashboard/`](dashboard) | `mediarr.davideghiotto.it` | mediarr-dash, the pipeline graph. Untouched by this work, and the hub's reference implementation. |

---

## Done and live

### Stack (`monitoring/`, committed, deployed)

- **Loki 3.7.8** and **Grafana Alloy v1.19.2** on the mini PC. Container stdout plus the host
  systemd journal, 30 day retention with the compactor enforcing it. Alloy rather than Promtail,
  which reached end-of-life on 2 March 2026.
- **NAS agents** in `monitoring/nas-agents/`: node_exporter, cAdvisor and Alloy all running.
- **Two scrape jobs for the NAS** at 60 s / 20 s, and a `nas-alerts` rule group.
- **qBittorrent exporter**, aggregate only.
- **Every dashboard panel and the MemoryPressure / DiskFillingUp rules pinned to
  `instance="homelab"`.**
- **Temperature panels join `node_hwmon_sensor_label`**, so `temp1` reads `Tctl`, `Composite`,
  `Sensor 2`.
- **A logs dashboard** and a Loki datasource in Grafana.
- **`node_exporter`'s processes collector removed on both boxes** — see the findings below.
- **Jellyfin viewers, from the NAS.** A forty-line stdlib exporter in `nas-agents/`
  (`jellyfin_exporter.py`, bind-mounted into `python:3.13-alpine`) reads `GET /Sessions` and
  exports `jellyfin_sessions_watching`, `_transcoding` and per-session position, runtime and
  progress, scraped by a third NAS job at 60 s. The server stays unmodified — no plugin. The
  overview dashboard gained a **Cinema** row: the counts, viewers over time, and a three.js panel
  drawing one screen per viewer (Business Text, `dashboards/viewers-3d.js`). Deployed, key in
  place, `jellyfin_up 1`.
- **The NAS runs Jellyfin 12.1**, which answers 401 to `X-Emby-Token` and `X-MediaBrowser-Token`.
  `Authorization: MediaBrowser Token="…"` is the only form left. The exporter always used it; the
  hub did not, and that is what its viewers node was failing on.

- **`loki-push.davideghiotto.it`** live, so the NAS ships logs out through the tunnel. Three
  independent layers in front of it: an Access application with no identity providers and one
  `non_identity` policy bound to the `nas-alloy` service token; a tunnel ingress rule restricted
  to `path: loki/api/v1/push`, so a leaked token can append but not read; and a loopback-bound
  origin. The token lives only in `/home/davide/nas-agents/.env` on the NAS.

Verified: 9/9 scrape targets up, and all four log streams flowing —
`{host="homelab"}` and `{host="nas"}`, each with `job=docker` and `job=journal`.

### Hub (`hub/`, committed, deployed on `:3003`)

Phases 1 to 7 are written, committed and **deployed**. Verified on the box:
every endpoint answers, `/api/containers` reports `source: "docker"`, the audit
log is writable, and a real restart through the dispatcher worked with its
replay correctly deduped.

- **The landing page is now `/`, a topology view**, and the old machine-first
  overview moved to `/overview`. Both flats on a ground plane, six devices, five
  paths; a pulled link fires one bead per scrape interval and a pushed one flows
  at its measured line rate, while the NAS's own tunnel out to `cinema.` sits
  still because nothing here observes it. `/api/topology` is built on top of
  `/api/summary` so the two cannot disagree about whether the NAS is up.
- **Read-only, and still no Docker socket in the hub itself.** The containers
  page and the actions layer talk to `tecnativa/docker-socket-proxy` on an
  `internal: true` network; the hub gets `DOCKER_HOST` and no socket mount.
- `/nas`, `/containers`, `/logs` and `/actions` are real pages now. `/media` is
  the only placeholder left, and only its read side is missing — the writes are
  on `/actions`.

Phase 2 added `server/src/prom/registry.ts` (20 series), `prom/series.ts`
(clamping, framing, Grafana links) and the uPlot chart layer. Two things it
taught: the step and rate window must floor on each machine's **scrape
interval**, or NAS panels come back silently empty; and series must sort by key
rather than label, or load average reads 15m, 1m, 5m.

Read the password with `ssh homelab 'grep HUB_PASSWORD ~/hub/.env'`. It was
generated on the box and has never left it.

---

## What is left, in order

**2 to 7 are written.** What each one decided is now in `hub/README.md` and in
the commit messages, which is where it belongs; this file keeps only what is
still ahead.

**8 — Polish.** The last one.

- ~~`/media`'s read side~~ **done, 2026-09-20.** The whole pipeline is on the
  hub now: seven collectors in `hub/server/src/media/collect/`, `/api/media`,
  and a React Flow graph at `/media` with a card per service and the lists
  behind the numbers in a drawer. `collect-env.sh` grew the Prowlarr, Bazarr
  and Jellyseerr keys and has been run on the box; six of seven services
  answer. **mediarr-dash is now a duplicate and is to be retired** — see the
  item below.
- Alert detail, keyboard nav, a `CLAUDE.md` for the hub repo (still not
  written), a screenshot pass in both themes.
- Publish `monitoring.davideghiotto.it` through the tunnel, which is its own
  item below.
- Run `ssh -t homelab 'bash ~/hub/scripts/collect-env.sh'` when the write
  actions are wanted: it reads the *arr keys out of the containers and asks for
  the qBittorrent login and, optionally, the Dokploy key and its
  `label=composeId` allow-list. Until then those actions show themselves as
  unavailable with the reason, which is the intended degraded state. Container
  start/stop/restart already work and need nothing.

## mediarr-dash, retired 2026-09-20

Done. It existed only for the pipeline graph and that graph is on the hub now;
nothing else in the estate read from it. What was removed, in this order:

1. **The container.** `docker compose down` in `~/mediarr-dash` — it was plain
   compose, never a Dokploy app — and `docker rmi mediarr-dash:latest`. The
   source directory on the box is untouched and is now just files.
2. **The hostname.** Tunnel ingress rule (25 rules → 24, catch-all still last),
   then the Access application `mediarr`, then the proxied CNAME.
   `mediarr.davideghiotto.it` no longer resolves.
3. **The link out of the hub.** `links.mediarr`, the `"mediarr"` key in
   `Summary.links`, and its row in the overview's *Elsewhere* list.
4. **The tree**, kept at `dashboard/` with a retirement notice at the top of its
   `README.md` and `CLAUDE.md`. Not deleted: its collectors are the reference
   for anything the port got wrong, and its notes on the upstream APIs are still
   worth reading.

**Not to be confused with the `mediarr` stack**, which is the containers
themselves — Jellyseerr, the \*arrs, qBittorrent, Bazarr and `jellyfin-proxy`.
Those stay; they are what `/media` reads.

## Findings that cost time to discover

Keep these; each one was an hour.

**The NAS has no tailnet egress.** Its `tailscale` container runs `--network host` but in
**userspace** mode, so the host has no `tailscale0` device. Inbound works because userspace
tailscaled proxies to the host's `127.0.0.1` — which is why `ssh nas` works, why `cinema.` works,
and why binding the NAS exporters to loopback still lets Prometheus scrape them while keeping them
off Ilario's LAN. But nothing can get out to the tailnet, and there is no LAN route either (the
matching `192.168.15.0/24` on both boxes is a coincidence; the NAS is on a different physical
network). A reverse SSH tunnel is out too: its sshd sets `AllowTcpForwarding no`. Hence logs push
out through the internet to the tunnel.

**`scp` to the NAS does not work.** UGOS chroots the SFTP subsystem that modern scp speaks to a
share-only root — an `sftp` session shows just `docker`, `home` and `test` at `/`. So an absolute
shell path resolves to nothing over SFTP and every upload fails with "No such file or directory"
while `touch` on the same path works fine over ssh. `nas-agents/deploy.py` pipes through `cat`
instead. rsync is not installed there either.

**`--path.rootfs` does not redirect procfs and sysfs**, and Docker masks
`/sys/devices/virtual/powercap` inside containers (the CVE-2020-8694 mitigation). The RAPL
collector therefore reports success and emits nothing. The NAS's node_exporter sets
`--path.procfs=/host/proc` and `--path.sysfs=/host/sys` to fix it. The mini PC's deliberately does
**not**: it measures real wall power at the plug, and `homelab:power_package_watts` joins
`node_hwmon_chip_names` on `chip`, which is not worth disturbing under 180 days of history for a
duplicate.

**`node_exporter --collector.processes` is a journal flood.** It walks every host PID, the
`docker-default` AppArmor profile denies it `ptrace read`, and the kernel audits every denial —
2370 lines an hour, 23% of the whole journal, and after Alloy landed, 23% of everything shipped to
Loki. Nothing plots `node_processes_*`; `node_procs_running` and `node_procs_blocked` come from the
always-on `stat` collector and need no ptrace. Off on both boxes now. Re-enabling means
`security_opt: [apparmor=unconfined]`, a real privilege increase for a metric no panel reads.

**qBittorrent 5.x renamed the session cookie.** It is `QBT_SID_<port>` —
`QBT_SID_8080` on this box — not `SID` as it was in 4.x. Matching on `SID=`
finds neither reliably, because `QBT_SID_8080=` does not contain `SID=`, so a
perfectly good login reads as a refusal. The hub forwards whatever cookies came
back rather than naming one. Checked on 2026-09-18 against WebAPI 2.15.1, where
auth is *not* bypassed for the LAN: an uncookied call is 403 and a wrong
password is 401.

**qBittorrent 5.2.3 answers a successful login with `204`.** `ghcr.io/martabal/qbittorrent-exporter`
(the one with per-torrent metrics) requires `200` and logs `authentication failed, status code: 204`
forever with correct credentials. The aggregate exporter in use works. This is fine anyway: a
`name`-labelled series per torrent is one churning series per torrent that ever existed, in a TSDB
that keeps 180 days. Naming the torrent is a live API question.

**`node_hwmon_sensor_label` does not exist for every chip.** amdgpu, nvme and k10temp have it; the
DIMM sensors, the WiFi chip and the ACPI zone do not, so an inner join silently drops them. The
expression in both the dashboard and `hub/server/src/collect/host.ts` has an `or … unless` fallback
half, and unlabelled sensors fall back to their **chip** rather than their sensor because both DIMM
sensors are called `temp1`.

**`ieee80211_phy0` / `mt7921_phy0` is the WiFi chip on a DOWN interface.** It frequently reads
hottest, and it tracks case temperature rather than load. This is what made the original
temperature chart confusing. Both panel descriptions now say so.

**The instantaneous APU rail crosses above measured wall power.** `node_hwmon_power_watt` averaged
15.5 W against a 20.3 W wall reading while peaking at 42.1 W, so single samples read as impossible
next to a plug figure that is itself an average. Use `homelab:power_package_watts:avg`.

**mediarr-dash asks Prometheus about `eno1`**, a NIC with no cable, so its host card's throughput
has read zero since it was written. Worth fixing there. The hub resolves the busiest real interface
per machine and caches it ten minutes.

**`${VAR:?}` in a compose file is evaluated for every service** whether or not its profile is
selected, so a hard requirement blocks even a partial deploy. That is why `nas-agents/compose.yml`
uses soft defaults plus a `logs` profile. And adding a `${VAR:?}` then deploying before the
variable exists takes the whole stack down — set it in Dokploy first.

**UGOS default ACLs defeat `umask`.** `/home/davide` on the NAS carries a default ACL that makes
new files `rwxrwxrwx` regardless, so a secret written with `umask 077` still lands world-readable.
`nas-agents/deploy.py` re-asserts `700` on the directory and `600` on the `.env` every run.

**`grafana/loki` is distroless.** No shell, no wget, no curl, not even busybox — so a compose
`healthcheck` of any shape exits -1 and marks a perfectly healthy Loki unhealthy forever. It sat
that way for 110 consecutive checks while serving reads and writes fine. Prometheus scrapes
`loki:3100/metrics` instead, with a `LokiDown` alert.

---

**A container's log level is in two different places depending on where it came
from.** `level` is a real stream label and only the **journal** streams have
one, because Alloy sets it from the syslog priority keyword — so it says `err`
and `warning`. Docker streams have no `level` label at all; what they have is
Loki's `detected_level`, inferred at ingest, which says `error` and `warn`. A
level filter that knew one vocabulary would silently return nothing for half the
stack, which looks exactly like "there are no errors". The hub's filter matches
both with `| level=~"…" or detected_level=~"…"`.

**`:ro` on a Docker socket does not make the Docker API read-only.** It applies
to the file node, not the protocol. `POST /containers/x/stop` works through a
read-only mount, and so does `POST /containers/create` with `Binds: ["/:/host"]`,
which is root on the box.

**node_exporter exports no size metric for an `sd` device**, and UGOS ships no
`smartctl`, so per-drive capacity and SMART health on the NAS are genuinely
unreadable. The bays say so rather than printing a zero.

**`node_md_disks_required` is the number that matters, not `node_md_degraded`.**
node_exporter does not export a RAID level at all. `md1` requires one member, so
`degraded` reads 0 and will keep reading 0 right up to the moment that disk
dies.

**`getComputedStyle().color` no longer converts `oklch()` to rgb.** Chrome
returns the colour function unchanged, so the hub's "paint it on a throwaway
element and read back what the browser computed" trick had silently stopped
working. uPlot never cared — a canvas fill parses `oklch()` — but `THREE.Color`
cannot, and falls back to **white without throwing**, so every material in the
WebGL scenes had been painting white over its token since phase 4. It only
became visible when the topology page put a large theme-coloured floor on screen
and dark mode made a white one obvious. `charts/theme.ts` now fills one canvas
pixel and reads it back, which is sRGB by definition.

**`@react-three/fiber` 9.7 declares `react <19.3`** and its reconciler is
version-coupled, so this is not a peer warning to wave through. The hub's
frontend pins React to `~19.2`.

**node_exporter's `systemd` collector cannot work from inside a container, and
says so at ERROR on every scrape.** It talks to systemd over the private dbus
socket at `/run/systemd/private`, which `--path.rootfs` does not redirect — the
same trap the RAPL collector fell into. So it emitted nothing
(`count({__name__=~"node_systemd.*"})` empty, `node_scrape_collector_success` 0)
while logging `couldn't get dbus connection` 240 times an hour. That is 3% of the
mini PC's log volume — not the flood the `processes` collector was — but it was
**100% of node-exporter's error lines**, which buried the errors worth reading.
Mounting the socket would fix it and would also hand the container a control
channel to systemd. Removed on 2026-09-18; the NAS had already left it off.

**tecnativa/docker-socket-proxy filters by resource, not by method and path.**
`CONTAINERS=1` with `POST=1` allows every POST and DELETE under `/containers`:
`POST /containers/{id}/exec` answered 201 and `POST /containers/create` reached
the daemon, which with `Binds: ["/:/host"]` is root on the host — the exact
escape the proxy exists to prevent. `ALLOW_START` / `ALLOW_RESTARTS` do not help,
because the rule above them denies every non-GET unless `POST` is set. The hub
uses `wollomatic/socket-proxy`, which takes a regex per method, so the
allow-list is the literal set of requests it can make. It runs as `nobody`
(needs `DOCKER_GID`) and is distroless, so it carries no healthcheck — the Loki
lesson again.

**A named volume mounted onto a root-owned directory stays root-owned.** Docker
copies the image's ownership at a mountpoint into a volume only the first time
that volume is mounted empty, so `/data` has to be created and chowned in the
Dockerfile. Missed once here, and it failed quietly because the audit writer
swallows its errors on purpose — which made a broken audit look exactly like an
empty one. `/api/actions/log` now reports `writable`.

**Jellyfin has been unreachable from the box since before this page existed.**
`jellyfin-proxy` forwards to the NAS at `${NAS_TAILNET_IP}:8899` and that upstream
times out; `cinema.davideghiotto.it` answers Cloudflare 1033, which is a tunnel
with no origin behind it. So the hub's Jellyfin node reads *down — timed out*,
and it is right to. Two things are worth knowing while looking at it: there is
now also a local `jellyfin` container on the box answering on **8097**
(`homelab-jellyfin`), which is not the server the pipeline feeds; and
`JELLYFIN_URL` in `~/hub/.env` is a hard-coded `192.168.15.126:8096`, which is
the one LAN IP in the whole setup and the rule against those exists for a
reason.

## Open, needing a human

- **Docker log rotation.** `/etc/docker/daemon.json` with `max-size: 50m`, `max-file: 3`. Needs
  sudo and restarts every container, so schedule it rather than letting it ride along with a
  deploy. **The only remaining item from the original plan that still needs a human.**
- **`monitoring.davideghiotto.it` is not published yet.** The hub is LAN-only on `:3003` on
  purpose: `COOKIE_SECURE=true` stops a browser storing the session cookie over plain HTTP, so
  publishing it ends LAN logins and moves verification onto the box. Worth doing once the read-
  only phases are finished.
- **The NAS's `tailscale` container carries a plaintext `TS_AUTHKEY`** in its environment, readable
  by anyone in the `docker` group. The node is already authenticated, so revoking that key costs
  nothing. Ilario's to do.
- **Loopback services on the NAS are tailnet-wide.** Because userspace tailscaled proxies to
  `127.0.0.1`, everything bound to loopback there is reachable from the whole tailnet — Redis on
  6379 answers from the mini PC. Broader exposure than "bound to 127.0.0.1" suggests.
- **Four bays, one disk.** A ~2007 Seagate ST3320820AS in a single-member `md1` raid1, `/volume1`
  at 82%. The `raid1` label is not redundancy, and `smartctl` is not installed so disk health
  cannot be scraped.
- **No Alertmanager.** Rules fire into nothing. The hub shows them read-only; do not build an
  acknowledge button whose state lives only in one process.
