# Homelab

Notes for the mini PC on the LAN.

## Host

| | |
|---|---|
| Hostname | `debian` |
| mDNS | `debian.local` |
| LAN IP | `192.168.15.126/24` — DHCP, held by a router reservation on `84:47:09:a3:57:a4` |
| OS | Debian 13 (kernel 6.12.107+deb13-amd64, x86_64) |
| User | `davide` |

## Hardware

| | |
|---|---|
| Model | GMKtec M6 Ultra (firmware 1.06) |
| CPU | AMD Ryzen 5 7640HS, 6 cores / 12 threads, Radeon 760M |
| RAM | 40 GB |
| Disk | 1 TB NVMe (TWSC TSC3AN1T0-F6Q10S), LVM, `/dev/mapper/debian--vg-root` |
| NIC | `eno1`, Realtek RTL8125B via `r8169`, linked at 2.5 Gb/s |

## Services

Dokploy (`:3000`) with Traefik on `:80`/`:443`, Docker Swarm active.
Monitoring stack in [`monitoring/`](monitoring/) — Grafana on `:3001`, and at
`https://grafana.davideghiotto.it` through the Cloudflare Tunnel behind Access.

Web apps run as Dokploy apps, each published on the tunnel and deployed by its own CI rather
than by Dokploy's auto-deploy — `calorico.davideghiotto.it`, `thumb.davideghiotto.it`,
`ral-api.davideghiotto.it` and `wedding.davideghiotto.it` (with its guest-list dashboard on
`wedding-admin.davideghiotto.it`) today, all four moved here off a Hetzner VPS on 2026-09-15,
which emptied it. `maestro.davideghiotto.it` ([repo](https://github.com/davide97g/maestro)) was
built here on 2026-09-17 rather than ported: a compose app, SQLite on the `maestro-data` volume,
no CI yet, so it is released with one `compose.deploy` call. It carries an LLM API key, so it has
its own email/password login (Better Auth, self-hosted) and registration is invite-only —
`SIGNUP_MODE`/`SIGNUP_CODE` in its Dokploy environment. It is not behind Access. All are **compose** apps except ral-gate, a Dockerfile **application**,
which changes the API endpoints but nothing else.
`atlante.davideghiotto.it` is the backend for [Atlante](https://github.com/davide97g/atlante),
the self-hosted maps app, built here on 2026-09-19 rather than ported. A compose app: Fastify API,
PostGIS with the Italy OSM index, Valhalla and Martin. The heavy artefacts — the PMTiles basemap
and the Valhalla routing graph, ~4 GB — are built on the Mac and rsynced to `~/atlante/`, which is
bind-mounted; nothing large is ever built on this box. Its own
[`DEPLOY.md`](https://github.com/davide97g/atlante/blob/main/DEPLOY.md) is the runbook. Not behind
Access: a native iOS client cannot pass an Access challenge, so Clerk bearer tokens are the gate
and every route except `/health` requires one. No CI yet — released with one `compose.deploy` call.

[`porting-to-homelab.md`](porting-to-homelab.md) is the runbook for moving the next one:
the order of operations, the Dokploy and Cloudflare API calls, and the traps. The
credentials every step of it needs are in the gitignored [`.env`](.env) beside it.

Media requests and downloads live in the [`mediarr`](../mediarr) project — Jellyseerr on
`:5055`, Radarr `:7878`, Sonarr `:8989`, Prowlarr `:9696`, Bazarr `:6767`, qBittorrent
`:8080`, the NAS Jellyfin shim `:8096`, and since 2026-09-19 a local Jellyfin on `:8097` with
Cinema's web client on `:8898`, LAN only, for the library that never made it to the NAS. Plain `docker compose` over SSH in `~/mediarr`, not a Dokploy app.
[`media-pipeline.md`](media-pipeline.md) covers how those fit together — subtitles,
availability, Telegram, and the traps found along the way.

[manga](manga/) ([repo](https://github.com/davide97g/manga), private) since 2026-09-23 —
Suwayomi downloads, Kavita library, Yomu reader. Plain `docker compose` in `~/manga`, not Dokploy.
Only Yomu is public, `manga.davideghiotto.it` -> `http://localhost:4571`, not behind Access
(Kavita's login is the gate, and Yomu's nginx forwards only the reader's API routes). Suwayomi
`:4567` and Kavita's admin UI `:5000` are LAN only. Its [README](manga/README.md) is the runbook.

[riddle](../riddle) runs here too, since 2026-09-21 — the reMarkable diary. Two
**user** systemd units out of `~/riddle` (`riddle-voice`, `riddle-diary`) with
`uv` for the venv, not Dokploy and not a container: the loop's job is to hold an
ssh pipe open to the tablet at `192.168.15.135` and a sqlite file beside the
page, so a network to cross would only be in the way. The page is on the tunnel
at `riddle.davideghiotto.it` -> `http://localhost:8765`; **the tablet is LAN
only** and nothing about it is published. Not behind Access — it carries its own
password (`RIDDLE_WEB_PASSWORD` in `~/riddle/.env`), because Access would mean a
second login on every device for a page that is already one field. Its
[`docs/deploy.md`](../riddle/docs/deploy.md) is the runbook. No CI: `git pull`,
rebuild the client if it changed, `systemctl --user restart`. The only `sudo`
this box needed for it was `build-essential` and `cmake`, to build
`parakeet-cli` (whisper.cpp v1.9.1, static) for the page's microphone —
whisper.cpp ships no Linux binaries.

[`local-ai/`](local-ai/) — Ollama since 2026-09-24, `:11434`, LAN and tailnet only (no auth,
never on the tunnel). Qwen3.6-35B-A3B on the 760M through Vulkan, ~24 tok/s. The Open WebUI
chat in front of it is public at `openui.davideghiotto.it` -> `http://localhost:3080`, **not
behind Access**. Its own login is the gate (`OPEN_WEBUI_*` in `.env`, sign-up off). A LiteLLM
gateway gives friends their own API keys for their agents at `llm.davideghiotto.it`
(`/ui` to sign in and mint keys, `/v1` OpenAI and Anthropic APIs, `LITELLM_*` in `.env`),
also public, with no Access. Plain
`docker compose` in `~/local-ai`. Its [README](local-ai/README.md) is the runbook.

[`dashboard/`](dashboard/) draws that chain as a live graph on `:3002` — a node per service
with its own metrics, links into each web UI, and the host's load underneath. Password
protected; the service API keys are read out of the containers and stay on the box.

`cloudflared` runs as a systemd service with a dashboard-managed token, so no inbound port
is forwarded to the box. Public hostnames are configured in Cloudflare Zero Trust, not on
disk.

## Always-on

Set up 2026-09-12. The box was suspending after 15 minutes idle and needed a physical power
button press to come back; GNOME's `sleep-inactive-ac-type` was `suspend` and the GDM greeter
session on `seat0` was enough to trigger it.

```sh
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

`logind` now reports `CanSuspend = no`, so nothing can suspend the box regardless of desktop
settings. The masks are symlinks to `/dev/null` in `/etc/systemd/system/` and survive reboots.
The user and GDM `sleep-inactive-ac-type` keys were set to `nothing` as well, to stop GNOME
retrying.

To undo: `sudo systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target`.

### Known, not acted on

`eno1` has EEE (Energy Efficient Ethernet) `enabled - inactive`. `r8169` plus EEE causes random
link flaps on some RTL8125 units. It was not the cause of the suspend problem and has not
misbehaved here. `EthernetLinkFlapping` in the monitoring stack watches for it.

## Access

```sh
ssh homelab
```

Set up 2026-09-11:

- Dedicated key `~/.ssh/id_ed25519_homelab` (ed25519, no passphrase), public half installed
  in the box's `~/.ssh/authorized_keys` via `ssh-copy-id`.
- Host key pinned in `~/.ssh/known_hosts`.
- Alias in `~/.ssh/config`:

```
Host homelab
    HostName debian.local
    User davide
    IdentityFile ~/.ssh/id_ed25519_homelab
    IdentitiesOnly yes
    AddKeysToAgent yes
    UseKeychain yes
```

`HostName` is the mDNS name, so it follows the box if DHCP hands it a different address.
Swap in `debian` (the tailnet name, always current) if mDNS ever stops resolving. Reach for
the raw IP last: on 2026-09-14 the lease moved to `192.168.15.126` and every address baked
into a config broke at once, the dashboard included.

## The NAS

Ilario's UGREEN NASync **DXP4800 Pro** — `DXP4800PRO-21AF`, Linux 6.18.15, UGOS Pro.
It is **at his house, not on this LAN**. There is no route to it except Tailscale.

| | |
|---|---|
| Tailscale IP | `${NAS_TAILNET_IP}` (node `dxp4800pro-21af`) |
| Account there | `davide` |
| Alias | `ssh nas`, on both the Mac and the box |
| Storage | `/volume1` 278 G, ~240 G free |
| Home quota | `/home/davide` is capped at **25 G** — not a place to put a library |
| Shares | `/volume1/docker`, `/volume1/test`. **There is no media share yet.** |

An older `Host nas` in the Mac's `~/.ssh/config` pointed at `192.168.15.129` as user
`ilario`, from when the NAS was on this LAN. That address answers nothing now and the
entry was replaced rather than kept alongside.

### Two tailnets, one shared node

The Mac and the box are on `ghiotto.davidenko@gmail.com`; the NAS and Ilario's phone are
on `<nas-owner-email>`. A client joins one tailnet at a time, so the NAS is **shared in**
to ours rather than us switching accounts. Both halves of that matter — switching the Mac
to his tailnet works, but then the box and the Pi drop out of view.

| Node | Tailnet | Address |
|---|---|---|
| `debian` (this box) | ghiotto | `${BOX_TAILNET_IP}` |
| `vvtgg3pwlh` (Mac) | ghiotto | `${MAC_TAILNET_IP}` |
| `dxp4800pro-21af` | Ilario, shared in | `${NAS_TAILNET_IP}` |

Tailscale was installed on the box on 2026-09-14 with `--accept-dns=false`, deliberately:
Docker containers inherit the host's `/etc/resolv.conf`, and there is no reason to put
MagicDNS in that path for a file transfer.

**The link is direct, not relayed.** `tailscale ping nas` opens on `via DERP(fra)` for the
first two or three packets and then upgrades to `via <home-wan-ip>:33337` at ~2 ms from
the box. If it ever *stays* on DERP, throughput will be a fraction of the line rate and
that is the thing to investigate. Our side traverses cleanly — `netcheck` reports UDP yes,
`MappingVariesByDestIP: false`, and UPnP on the FRITZ!Box.

Set **Disable key expiry** on the NAS node in the Tailscale console. A node that expires
needs someone physically at Ilario's house to re-authenticate a container.

### Its Jellyfin, on the public internet

The NAS runs its own Jellyfin — **`nasilario`, 12.1.0**, a Docker container whose
`8096` is published on the host as **`:8899`** (`ss` shows no `8096`; the container sits on
`172.17.0.2`). It is not the box's `jellyfin` container and shares nothing with it.

Upgraded 2026-09-15 from `ugreen/jellyfin:10.10.7` to the **official `jellyfin/jellyfin:12.1`**:
UGREEN publishes no image past 10.10.7 and `ugreen/jellyfin` is not a public Docker Hub repo,
so there is nothing newer to pull under that name. The app is still the UGOS app-store one —
compose file `/volume1/@appstore/com.ugreen.docker.jellyfin/docker-compose.yaml`, previous
version kept beside it as `docker-compose.yaml.bak-10.10.7`. A UGOS app update may push the
vendor image back; the tag in that file is what to check first. Config backup before the jump:
`/volume1/test/jellyfin-config-backup-20260915.tar.gz` (156M) — 12.x migrates the database
forward and cannot be rolled back without restoring it.

**Drive compose with `-p jellyfin`.** The containers are named `jellyfin-app-1`, not
`comugreendockerjellyfin-app-1`; a bare `docker compose` in that directory derives the project
name from the directory, silently builds a *second* stack and fails on the `8899` bind while
the real one keeps running.

It answers on **`https://cinema.davideghiotto.it`** with no Tailscale on the client, over
a **second tunnel of its own, `nas-ilario`** — the NAS dials Cloudflare directly, so a
stream crosses Ilario's uplink once and never touches this box.

That hostname serves [Cinema](cinema/), the custom front end, from the `cinema-web`
container on `:8898`. **Jellyfin itself is no longer published on its own hostname**: as of
2026-09-17 `jellyfin.davideghiotto.it` is gone from both the tunnel and DNS, and Jellyfin is
reached under `https://cinema.davideghiotto.it/jf` — which is a complete Jellyfin base URL, so
native clients take it verbatim and the admin UI is at `/jf/web/`. On the LAN it is still
`:8899` as before.

To put the old hostname back: add an ingress rule `jellyfin.davideghiotto.it` ->
`http://localhost:8899` (before the catch-all) and a proxied CNAME to the tunnel.

**A second Cinema, on this box, at `https://home-cinema.davideghiotto.it`.** The NAS has ~45 GB
free against a 543 GB library, so most finished downloads never got copied there; since
2026-09-19 the mini PC plays its own library — Jellyfin on `:8097` (8096 is the shim onto the
NAS) with `cinema-web` on `:8898` in front of it, published on *this* box's tunnel. It is
**behind Access** (app `cinema (home)`), because that Jellyfin's admin account is deliberately
trivial for LAN use; the edge is the real gate, which also means native clients cannot use this
hostname and stay on `http://debian:8097`. One label, not `home.cinema.…`: Universal SSL does
not cover a second level. Details in [`cinema/docs/DEPLOY.md`](cinema/docs/DEPLOY.md).

| | |
|---|---|
| Tunnel | `nas-ilario`, `<nas-tunnel-uuid>` |
| Ingress | `cinema.davideghiotto.it` -> `http://localhost:8898`, managed in Zero Trust |
| DNS | proxied CNAME to `c5449ef2-….cfargotunnel.com` |
| Binary | `/usr/local/bin/cloudflared` (2026.9.1), `--no-autoupdate` |
| Config | `/usr/local/etc/cloudflared/{config.yml,<id>.json}`, root-owned `600`, dir `700` |
| Service | `/etc/systemd/system/cloudflared.service`, enabled, `Restart=always` |

```sh
ssh nas
sudo systemctl status cloudflared
sudo journalctl -u cloudflared -f
```

The credentials file is derived from the tunnel token: it is base64 JSON, and `a`/`t`/`s`
map to `AccountTag`/`TunnelID`/`TunnelSecret`. Running from that file rather than `--token`
keeps the secret out of `ps`, where any account on the NAS could read it.

#### Why it is a root service on the root filesystem

The first version of this ran as a systemd **user** service out of `/home/davide`, with
`loginctl enable-linger` (which, usefully, a user may set for themselves). A real reboot
killed it, and the journal says why:

```
18:56:43  boot
18:56:53  systemd --user starts, enumerates ~/.config/systemd/user, finds nothing
18:56:59  /home mounts — six seconds too late
```

The user manager reaches `default.target` in 499 ms against a `/home` that is not mounted
yet, so an enabled unit living there is never seen. Nothing is wrong with the unit; it
works the moment the volume appears. **Anything that must survive a reboot on this NAS
therefore belongs on the root overlay (`/`), not on the storage pool.** `/usr/local` is
part of `/`, so the service has no `/home` reference at all and no mount ordering to get
right. The user unit, the linger and the `/home` copies of the binary and credentials are
all gone — one connector, one supervisor.

For a while the mini PC covered the gap with a cron watchdog that sshed in to start the
tunnel. That is deleted: the NAS depends on nothing but itself.

#### sudo on this NAS

`davide` is in the `admin` group, which is in sudoers — `sudo -n -l` answering *"a password
is required"* rather than *"may not run sudo"* is how to tell. The password is
`NAS_PASSWORD` in [`.env`](.env), and it is **not** either of the UGOS web-UI passwords.

Its sudo refuses a piped password with `no password was provided`, which reads like a
delivery bug and is a tty requirement. Two ways through:

```sh
ssh -t nas 'sudo …'                     # interactive, prompts in your terminal
printf '%s\n' "$NAS_PASSWORD" | ssh nas 'bash ~/.sudo-run.sh <cmd>'   # scripted
```

`~/.sudo-run.sh` reads the password from stdin into `SUDO_ASKPASS`, so it never reaches a
file or a command line. Note also that `bash -s` cannot be fed a script and a password on
the same stdin — the `read` eats the next line of the script.

**Check the permissions on anything written into `/home` there.** The share's default ACL
made the first unit file `-rwxrwxrwx`, which systemd complains about and honours anyway — a
world-writable unit is an invitation to run someone else's command as `davide`.

**Nothing in front of it but Jellyfin's own login.** `grafana` and `mediarr` sit behind
Cloudflare Access; this does not, because native Jellyfin clients on a TV or phone cannot
complete an Access login — only browsers can. The library it serves is Ilario's.

### Transferring to it

`~/xfer-nas.sh` on the box. Defaults to one film; point it anywhere with `SRC`.

```sh
ssh -t homelab "NAS_DEST=/volume1/test/movies ~/xfer-nas.sh"
ssh -t homelab "SRC='/path/to/folder' NAS_DEST=/volume1/test/movies ~/xfer-nas.sh"
```

```
progress    tail -f ~/xfer-nas.log
live rate   tail -c 200 ~/xfer-nas.log.raw
last line   cat ~/xfer-nas.status
attach      tmux attach -t xfer-nas     (ctrl-b then d to detach)
stop        tmux kill-session -t xfer-nas
```

**rsync does not work against this NAS.** UGOS ships a UGREEN build of rsync 3.4.1 that
always behaves as a daemon: every destination is rejected with `invalid path`, including
the user's own `/home/davide`, and `/etc/rsyncd.json` is root-only with no modules defined,
so `rsync -e ssh nas::` gets no server greeting either. Nothing about this is fixable from
the `davide` account. If Ilario ever enables the rsync service in UGOS, retest — rsync is
the better tool. Until then the script does resume by hand:

```
remote size N  ->  tail -c +N+1 local | ssh nas 'cat >> remote'
```

`tail -c +N` is byte-exact, so an interrupted file continues where it stopped instead of
restarting. Progress comes from `dd status=progress`, which avoids depending on `pv`
(not installed, and installing it needs the box's sudo password). Files go smallest-first,
so a subtitle proves the path before a multi-gigabyte file commits to it. Every file is
md5'd on both sides at the end.

FTP was considered and passed over: ports 21, 20 and 990 are all closed on the NAS, and
neither `lftp` nor `ftp` is on the box — two changes to get started against zero. Worth
revisiting if throughput ever disappoints, since `lftp` has `REST` resume, `--rate-limit`,
and `pget -n` for parallel segments. Plaintext is not a concern inside Tailscale.

**Going through the box, not the Mac, is the point.** The files already live on the box.
Mac → NAS means pulling each one off the box and pushing it back out — twice the bytes over
the same uplink. It halves the work and removes Wi-Fi and laptop sleep from the equation.

### What it actually runs at

First real transfer, 2026-09-14: 6.9 G in **6m 14s**, ~20 MB/s average and 22.4 MB/s
sustained, single attempt, no retries, both md5s matched.

That is ~180 Mbps, comfortably above the 121 Mbps `networkQuality` reported for this
uplink — so treat that figure as pessimistic rather than as the ceiling. The transfer did
**not** collapse the way UGREEN's own web uploader did, and no rate cap was needed. If a
future transfer does start collapsing, the fix is a `--rate-limit`-style cap at roughly
85–90% of whatever the line is doing: capping below line rate keeps the router's upstream
buffer empty and raises the average. Measured bufferbloat here is real — idle latency
28.8 ms, 229.2 ms under load.

### Not possible as things stand

The movie library is **301 G** and `/volume1` has **~233 G** free after the first film. The
whole library does not fit. Individual films do.

[`observability-plan.md`](observability-plan.md) is the running plan for logs, NAS
monitoring and the hub at `monitoring.davideghiotto.it`: what is live, what is left, and
the findings that cost time to discover.
