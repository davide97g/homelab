# Homelab

Everything that runs on the homelab, in one repository: the mini PC on the LAN (`debian`), the
NAS it shares a tailnet with, and every app, stack and runbook for both. Each app keeps its own
history from before the merge, under `apps/`.

## Layout

| Path | What |
|---|---|
| [`apps/`](apps/) | The projects: [cinema](apps/cinema/), [hub](apps/hub/), [monitoring](apps/monitoring/), [tv](apps/tv/), [local-ai](apps/local-ai/), [adguard](apps/adguard/), [memories](apps/memories/), [accounts](apps/accounts/), [site](apps/site/), [status](apps/status/) |
| [`stacks/`](stacks/) | Plain compose and config stacks: [mediarr](stacks/mediarr/), [swarm](stacks/swarm/) |
| [`docs/`](docs/) | Runbooks: [porting to the homelab](docs/porting-to-homelab.md), [media pipeline](docs/media-pipeline.md), [observability plan](docs/observability-plan.md), [web apps](docs/web-apps.md), [where every secret lives](docs/secrets.md) |
| [`hosts/`](hosts/) | Per-host notes and installers: [the NAS](hosts/nas.md); for the box, [firewall](hosts/debian/firewall/), [backup](hosts/debian/backup/), [nas-backup](hosts/debian/nas-backup/), [offsite](hosts/debian/offsite/), [restore-drill](hosts/debian/restore-drill/), [nas-deploy](hosts/debian/nas-deploy/), [nas-sync](hosts/debian/nas-sync/), [host-metrics](hosts/debian/host-metrics/) |
| [`cloudflare/`](cloudflare/) | Tunnel ingress for both tunnels, applied with [`tools/cloudflare`](tools/cloudflare/) |
| [`hardware/`](hardware/) | The 3D-printed [M6 stand](hardware/m6-stand/) |
| `.env` | Credentials, gitignored. [`.env.example`](.env.example) lists the keys |

On the box, `~` is laid out as:

| Path | What |
|---|---|
| `~/projects/` | Checkouts: this repo, [riddle](../riddle), mediarr-dash |
| `~/ops/` | Host scripts run by timers, e.g. `ops/xfer-nas/` (script, logs, status) |
| `~/backups/` | One-off snapshots and rescues, one folder per app |
| `~/media`, `~/atlante` | Live data, bind-mounted by the Dokploy stacks. Do not move without updating the compose files |
| `~/mediarr/heal.sh`, `~/finance-autodeploy` | Also live: run by a system timer and mounted into a container |

## Projects

| Project | Path | Runs on | Public URL | Deploy |
|---|---|---|---|---|
| Cinema, Jellyfin front end | `apps/cinema` | NAS | `cinema.davideghiotto.it` | push to `main` ([nas-deploy](hosts/debian/nas-deploy/)) |
| Memories, Immich's public door | `apps/memories` | NAS | `memories.davideghiotto.it` | push to `main` ([nas-deploy](hosts/debian/nas-deploy/)) |
| Accounts, single sign-on (OTP, invites, TV codes) | `apps/accounts` | NAS | `accounts.davideghiotto.it` | push to `main` ([nas-deploy](hosts/debian/nas-deploy/)) |
| Hub, the homelab's front door | `apps/hub` | mini PC, Dokploy | `monitoring.davideghiotto.it` | push to `main` |
| Monitoring: Prometheus, Grafana, Loki | `apps/monitoring` | mini PC, Dokploy; agents on the NAS | none, Grafana at `http://debian:3001` | push to `main`; NAS agents too, via [nas-deploy](hosts/debian/nas-deploy/) |
| JARVIS on the TV | `apps/tv` | Philips TV and mini PC | via Access | server: push to `main`. APK: `scripts/deploy-tv.sh` |
| Status page: public uptime, 90 days | `apps/status` | Cloudflare Worker; probes and publisher on the mini PC | `status.davideghiotto.it` | `apps/status/worker/deploy.sh` |
| Landing page: the homelab explained simply | `apps/site` | mini PC, `~/homelab-site` | `homelab.davideghiotto.it` | `apps/site/deploy/deploy.sh` |
| Dirette YouTube: Ciamioncino Ring Road | `apps/youtube-live` | mini PC, Dokploy | none | [local image and OBS recording](apps/youtube-live/) |
| Local AI: Ollama | `apps/local-ai` | mini PC, Dokploy | none, LAN and tailnet only | push to `main` |
| AdGuard Home, DNS ad blocking for the house | `apps/adguard` | mini PC, Dokploy; the FRITZ!Box forwards to it | none, UI at `http://debian:3053` | push to `main` |
| mediarr: the *arr stack, qBittorrent, Jellyseerr | `stacks/mediarr` | mini PC, `~/mediarr` | none, LAN only | push to `main` |
| Swarm, qBittorrent WebUI | `stacks/swarm` | mini PC, inside qBittorrent | none, `http://debian:8080` | push to `main` |

`riddle` also runs on the box but is its own repository (see below).

## Deploying

**Push to `main`.** Every stack that runs on the mini PC is a Dokploy compose app sourced from this
repository (GitHub provider, branch `main`, its own compose path), so all of them are visible and
restartable in the Dokploy UI at `http://debian:3000`. Dokploy's own auto-deploy is off: each app
has a workflow in [`.github/workflows/`](.github/workflows/) that runs only when its folder
changes, checks it (build, lint, `docker compose config`), and then calls the shared
[`dokploy-deploy.yml`](.github/workflows/dokploy-deploy.yml). That triggers `compose.deploy`
through `deploy-homelab.davideghiotto.it` — a tunnel hostname whose path rule lets only
`api/compose.(deploy|one)` through — and waits for Dokploy's verdict, so a failed deploy is a red
run. Each deployment is titled with its commit, which makes Dokploy's Deployments tab the version
history; rolling back is reverting the commit.

| App | Dokploy app name | Compose path | Workflow |
|---|---|---|---|
| hub | `hub-nppqob` | `apps/hub/docker-compose.yml` | `hub.yml` |
| monitoring | `monitoring-frontend-fnhjyi` | `apps/monitoring/docker-compose.yml` | `monitoring.yml` |
| local-ai | `local-ai-uurnqn` | `apps/local-ai/compose.yaml` | `local-ai.yml` |
| adguard | `adguard-pmtl66` | `apps/adguard/compose.yaml` | `adguard.yml` |
| jarvis-server | `jarvis-server-b7bwor` | `apps/tv/jarvis-server/docker-compose.yml` | `jarvis-server.yml` |
| mediarr | `mediarr-uvnh8c` | `stacks/mediarr/compose.yml` | `mediarr.yml` |
| swarm | `swarm-xxmn65` | `stacks/swarm/compose.yml` | `swarm.yml` |

The app name is the compose project name, and Dokploy picks it with a random suffix that cannot
be changed afterwards. So every named volume that predates Dokploy is pinned with `name:` to the
name it had under plain compose (`mediarr_radarr-config`, `hub_hub-data`, …);
networks are per-stack and were simply recreated. Secrets live in each app's Environment tab,
which Dokploy writes to a `.env` beside the compose file. Repository secrets: `DOKPLOY_URL`,
`DOKPLOY_API_KEY`, and one `DOKPLOY_COMPOSE_ID_<APP>` per app.

Not in Dokploy, because it cannot reach them: the NAS apps (Cinema, memories, accounts, the
monitoring agents), since Dokploy has no root docker on the NAS. They still deploy on push to
`main`: the box pulls every 5 minutes and ships what changed
([`hosts/debian/nas-deploy`](hosts/debian/nas-deploy/)). The TV launcher APK is installed over ADB.

## Host

| | |
|---|---|
| Hostname | `debian` |
| mDNS | `debian.local` |
| LAN IP | `192.168.15.126/24` — DHCP, held by a router reservation on `84:47:09:a3:57:a4` |
| OS | Debian 13 (kernel 6.12.115+deb13.1-amd64, x86_64) |
| User | `davide` |

Patching: `unattended-upgrades` installs Debian security updates every morning, but a new kernel
still needs a reboot (`/var/run/reboot-required`), and the third-party repos (Docker, cloudflared,
Chrome, Tailscale) are not covered: they come in with a manual `sudo apt full-upgrade`. Dokploy's
installer `apt-mark hold`s `docker-ce`, `docker-ce-cli` and `docker-ce-rootless-extras`. The hold
was lifted on 2026-11-03 for the 28.5 → 29.9 upgrade and not put back, so check Docker on every
manual upgrade. `sudo` asks for a password, so those runs are done by hand over `ssh -t homelab`.
The last full pass was 2026-11-24, with [`hosts/debian/hardening/apply.sh`](hosts/debian/hardening/)
(which also made SSH key-only): kernel 6.12.118, Docker 29.10.0, cloudflared 2026.11.2, Tailscale
1.104.7, Traefik 3.7.17, Dokploy 0.30.10. Dokploy went to 0.31.4 and Traefik to 3.7.20 on
2026-11-25 (`docker service update`, then `settings.updateTraefik`). `RebootRequired` and `AptUpgradesPending` say when the
next one is due. A Docker upgrade restarts every container, a running backup included.

Backup: every night at 03:30, restic sends the home directory, the Docker volumes, `/etc/dokploy`
and a `pg_dumpall` of every running Postgres to the NAS (`/volume1/docker/homelab-backup`),
encrypted. A failed or missing run reaches Telegram through Alertmanager. Runbook, restore and
the password's whereabouts: [`hosts/debian/backup`](hosts/debian/backup/). Since 2026-11-23;
before that `~/backups/` sat on the same single NVMe as everything it backed up.
The other direction runs at 04:30: Immich's photos, accounts' dumps and Jellyfin's config go from
the NAS to `~/nas-backup` on the box, through an ssh session the box opens
([`hosts/debian/nas-backup`](hosts/debian/nas-backup/), since 2026-11-24).
At 06:00 both repositories are copied to Backblaze B2 with a key that cannot delete
([`hosts/debian/offsite`](hosts/debian/offsite/)): the one copy a compromised box cannot wipe.
Every Wednesday a [restore drill](hosts/debian/restore-drill/) loads every database dump and a
few photos back out of both repositories into throwaway containers.

## Hardware

| | |
|---|---|
| Model | GMKtec M6 Ultra (firmware 1.06) |
| CPU | AMD Ryzen 5 7640HS, 6 cores / 12 threads, Radeon 760M |
| RAM | 40 GB |
| Disk | 1 TB NVMe (TWSC TSC3AN1T0-F6Q10S), LVM, `/dev/mapper/debian--vg-root` |
| NIC | `eno1`, Realtek RTL8125B via `r8169`, linked at 2.5 Gb/s |

## Services

Dokploy (`:3000`, v0.31.4) with Traefik v3.7.20 on `:80`/`:443`, Docker 29 with Swarm active.
Dokploy pins its own Traefik version in code and can lag behind fixes, so the `dokploy` service
carries `TRAEFIK_VERSION=3.7.20`: every Traefik recreate from the Dokploy UI uses it. Since 0.31
the Dokploy API has a safe update (`settings.updateTraefik`) that keeps env and ports and rolls
back on failure; it upgrades to that version. Traefik's `CF_DNS_API_TOKEN` (ACME DNS challenge, scoped to `davideghiotto.it`) lives only
in the `dokploy-traefik` container's environment — change it from Dokploy (Web Server → Traefik →
Environment), never by removing the container.
Monitoring stack in [`apps/monitoring/`](apps/monitoring/) — Grafana on `:3001`, LAN only since
`grafana.davideghiotto.it` was removed on 2026-09-19. The hub at `monitoring.davideghiotto.it`
is the public entrance.

### Web apps

Public web apps on the box, each behind its own tunnel hostname. How each one is built, published
and released, with its traps: [`docs/web-apps.md`](docs/web-apps.md). The live set of hostnames
is [`cloudflare/tunnels.json`](cloudflare/tunnels.json); what is up right now is
[status.davideghiotto.it](https://status.davideghiotto.it).

| Hostname (`.davideghiotto.it`) | What | Runs as | Access | Release |
|---|---|---|---|---|
| `calorico`, `thumb`, `ral-api`, `wedding`, `wedding-admin` | Apps moved off the Hetzner VPS on 2026-09-15 | Dokploy compose (ral-gate: application) | no | own CI |
| `maestro` | Maestro, invite-only login (Better Auth) | Dokploy compose, SQLite volume | no | `compose.deploy` |
| `atlante` | Atlante maps backend: Fastify, PostGIS, Valhalla, Martin | Dokploy compose, `~/atlante` bind mount | no, Clerk tokens | `compose.deploy` |
| `get-riddle` | Riddle's landing page | Dokploy compose, nginx | no | `compose.deploy` |
| `buriko` | Buriko's landing page | Dokploy compose, nginx | no | `compose.deploy` |
| `autocratico` | Autocratico, the paperwork register (now redirects to `app.autocratico.it`, same origin `:8790`) | Dokploy compose, `~/autocratico/data` | **yes** | `compose.deploy` |
| `get-autocratico` | Its landing page (now redirects to `autocratico.it`) | Dokploy compose, nginx `:8791` | no | `compose.deploy` |
| `echo` | Echo voice-clone demo | Dokploy compose `:8795`, `~/echo-demo` | no | `compose.deploy` |
| `slowgram` | Slowgram landing, privacy, support | Dokploy compose, nginx | no | `compose.deploy` |
| `aftergrowth` | Aftergrowth, the sky-island game | Dokploy compose, `aftergrowth-data` volume | no | own CI |
| `zootycoon` | Zoolandia, the zoo game | Dokploy compose, nginx `:8801` | no | own CI |
| `lumii` | LUMII Montecchio's restaurant app | Dokploy compose, Postgres + nightly dump | no | `compose.deploy` |
| `touchgrass` | Touchgrass, WebGL walk | plain compose `~/touchgrass`, nginx `:8796` | no | `deploy/deploy.sh` |
| `mirai` | Website proposal for Mirai Sushi, `noindex` | plain compose `~/mirai`, `:8797` | no | `deploy/deploy.sh` |
| `isoworld` | Isoworld landing and taster, with a save API | plain compose `~/isoworld`, `:8798` | no | `deploy/deploy.sh` |
| `nimbus` | Website proposal for Nimbus Pub, `noindex`, with a card-request API | plain compose `~/nimbus`, `:8799` | no | `deploy/deploy.sh` |
| `ciamioncino` | Ciamioncino, Godot web build and multiplayer relay | plain compose `~/ciamioncino`, `:8800` | no | `deploy/deploy.sh` |
| `videogiochi` | Game remakes landing | plain compose `~/videogiochi`, `:8802` | no | `deploy/deploy.sh` |
| `homelab` | This homelab, explained simply ([`apps/site`](apps/site/)) | plain compose `~/homelab-site`, `:8803` | no | `apps/site/deploy/deploy.sh` |

`compose.deploy` means one Dokploy API call after a push to that repo's `main`, since the app has
no CI of its own; the ids are in `.env` (`DOKPLOY_COMPOSE_ID_*`).

[`porting-to-homelab.md`](docs/porting-to-homelab.md) is the runbook for moving the next one:
the order of operations, the Dokploy and Cloudflare API calls, and the traps. The
credentials every step of it needs are in the gitignored [`.env`](.env) beside it.

Media requests and downloads live in the [`mediarr`](stacks/mediarr) project — Jellyseerr on
`:5055`, Radarr `:7878`, Sonarr `:8989`, Prowlarr `:9696`, Bazarr `:6767` (Forms login since 2026-11-03), qBittorrent
`:8080` (inside a ProtonVPN tunnel since 2026-09-26, with a kill switch on the hub's `/media`;
Prowlarr's searches use the same tunnel through gluetun's proxy, and nothing seeds),
and the NAS Jellyfin shim `:8096`. The mini PC's own Jellyfin (`:8097`) and its Cinema copy
(`:8898`, `home-cinema.davideghiotto.it`) were removed for good on 2026-10-10. Plain `docker compose` over SSH in `~/mediarr`, not a Dokploy app.
[`media-pipeline.md`](docs/media-pipeline.md) covers how those fit together — subtitles,
availability, Telegram, and the traps found along the way.

The manga stack (Suwayomi, Kavita, Yomu at `manga.davideghiotto.it`) ran here from 2026-09-23 and was
removed for good on 2026-11-23: Dokploy app, volumes, `~/manga`, tunnel route and DNS. Its code is in the
git history before that date.

[riddle](../riddle) runs here too, since 2026-09-21 — the reMarkable diary. Two
**user** systemd units out of `~/projects/riddle` (`riddle-voice`, `riddle-diary`) with
`uv` for the venv, not Dokploy and not a container: the loop's job is to hold an
ssh pipe open to the tablet at `192.168.15.135` and a sqlite file beside the
page, so a network to cross would only be in the way. The page is on the tunnel
at `riddle.davideghiotto.it` -> `http://localhost:8765`; **the tablet is LAN
only** and nothing about it is published. Not behind Access — it carries its own
password (`RIDDLE_WEB_PASSWORD` in `~/projects/riddle/.env`), because Access would mean a
second login on every device for a page that is already one field. Its
[`docs/deploy.md`](../riddle/docs/deploy.md) is the runbook. No CI: `git pull`,
rebuild the client if it changed, `systemctl --user restart`. The only `sudo`
this box needed for it was `build-essential` and `cmake`, to build
`parakeet-cli` (whisper.cpp v1.9.1, static) for the page's microphone —
whisper.cpp ships no Linux binaries.
Its landing page is the one part that *is* a Dokploy app: `get-riddle.davideghiotto.it`
-> `http://localhost:80`, compose app `riddle-site-mtycqg` in project `riddle`, built from
`apps/site/compose.yml` in the riddle repo (2026-09-27). Static nginx, no data, no CI yet,
so a release is one `compose.deploy` call; its [README](../riddle/apps/site/README.md)
has the rest.

[`apps/local-ai/`](apps/local-ai/) — Ollama since 2026-09-24, `:11434`, LAN and tailnet only (no auth,
never on the tunnel). Qwen3.6-35B-A3B on the 760M through Vulkan, ~24 tok/s. Open WebUI and
SearXNG were removed for good on 2026-11-23, and the public LiteLLM gateway
(`llm.davideghiotto.it`) on 2026-11-25. A Dokploy compose app (`local-ai-uurnqn`). Its [README](apps/local-ai/README.md) is the runbook.

mediarr-dash used to draw that chain as a live graph on `:3002`. It is retired, its
container is gone from the box, and its code was deleted from the repo; it lives on at
[`daf3ffb`](https://github.com/davide97g/homelab/tree/daf3ffb/archive/dashboard). [`apps/hub`](apps/hub/) replaced it.

`cloudflared` runs as a systemd service with a dashboard-managed token, so no inbound port
is forwarded to the box. Its public hostnames are kept in [`cloudflare/tunnels.json`](cloudflare/tunnels.json)
and applied with [`tools/cloudflare/tunnels.py`](tools/cloudflare/) (since 2026-11-23); Access
applications are still managed in the Zero Trust dashboard.

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

Ilario's UGREEN DXP4800 Pro, **at his house**, reachable only over Tailscale (`ssh nas`). It runs
the only Jellyfin (behind [Cinema](apps/cinema/) at `cinema.davideghiotto.it`), Immich (behind
[Memories](apps/memories/)) and [Accounts](apps/accounts/), each published through its own tunnel
`nas-ilario`, so streams never cross this box. New library files reach it through
[`hosts/debian/nas-sync`](hosts/debian/nas-sync/); the box's nightly backup lands on it too.
Everything else — tailnets, Jellyfin's history, sudo there, transfers, rsync that does not work,
measured throughput — is in [`hosts/nas.md`](hosts/nas.md).

[`observability-plan.md`](docs/observability-plan.md) is the running plan for logs, NAS
monitoring and the hub at `monitoring.davideghiotto.it`: what is live, what is left, and
the findings that cost time to discover.
