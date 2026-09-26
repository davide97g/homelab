# mediarr

The request-to-file chain, running on the [homelab](../../README.md) box, `debian`.

```
Jellyseerr -> Radarr / Sonarr -> Prowlarr -> qBittorrent -> Bazarr -> Jellyfin
  (asks)        (decides)        (searches)   (downloads)   (subs)    (plays)
```

Jellyseerr records what people want. Radarr and Sonarr turn a request into a search and file
the result. Prowlarr is the single place indexers are configured, and pushes them to both.
qBittorrent does the transfer. Bazarr fetches subtitles for whatever gets imported. Jellyfin
plays it and reports back, which is what flips a request to *Available*.

| Service | URL | Role |
|---|---|---|
| Jellyseerr | http://debian:5055 | Requests and discovery |
| Radarr | http://debian:7878 | Movies |
| Sonarr | http://debian:8989 | TV |
| Prowlarr | http://debian:9696 | Indexers, synced to both |
| qBittorrent | http://debian:8080 | Download client, torrenting through ProtonVPN (gluetun) |
| gluetun | `172.17.0.1:8001`, bridge only | The ProtonVPN tunnel qBittorrent lives in; control API for the hub |
| Bazarr | http://debian:6767 | Subtitles, `.srt` next to the video |
| Jellyfin | http://debian:8097 | Local server, plays this box's library |
| Cinema | http://debian:8898 | Cinema's web client in front of it, `/jf` proxied |
| Jellyfin (NAS) | http://debian:8096 | **Not a Jellyfin** — an nginx shim onto the NAS's |

There are two Jellyfins now, on two ports, and only one of them runs here.

`debian:8097` is the local one, back on 2026-09-19 with the config volume it wrote before it
was retired — same users, same watch state, same two libraries on `/data/library/{movies,tv}`.
It exists because the NAS has ~45 GB free against a 543 GB library, so `xfer-nas-auto.timer`
is off and most finished downloads are readable only on this box. `debian:8898` is Cinema's web
client pointed at it, the same image `cinema.davideghiotto.it` serves, built from
`~/cinema/services/web` with a `.env` naming `http://172.17.0.1:8097`.

Nothing was repointed onto it: Jellyseerr, hub, mediarr-dash and jarvis all still mean the NAS
when they say `8096`. The only one is on the NAS, and `~/xfer-nas-auto.sh` copies each
finished folder to it; `debian:8096` is `jellyfin-proxy`, which forwards to
`http://${NAS_TAILNET_IP}:8899` and rewrites one header on the way. The NAS runs Jellyfin 12, which
dropped the Emby-era `X-Emby-Authorization` that Jellyseerr still sends and answers 401 to it —
so without the shim Jellyseerr cannot reach that server at all.

Keeping the shim on port 8096 means everything that already said "Jellyfin is at `debian:8096`"
— hub, mediarr-dash, jarvis — keeps working unchanged.

## Layout

| File | Role |
|---|---|
| `compose.yml` | The services, one network, and gluetun (the VPN) with qBittorrent inside its namespace. |
| `.env` | Deploy target, `MEDIA_ROOT`, `PUID`/`PGID`, Jellyfin's LAN URL, the ProtonVPN and gluetun keys. Not committed. |
| `scripts/deploy.sh` | Trigger a Dokploy deploy, or run `pull`/`down`/`logs` against Dokploy's checkout. |
| `scripts/wire.sh` | The API calls that are the same every rebuild. Idempotent. |
| `scripts/install-service.sh` | Installs the systemd units on the box. Needs sudo there. |
| `scripts/heal.sh` | Runs on the box every minute; restarts hung or missing containers. |
| `scripts/vpn.sh` | `prep` turns on qBittorrent's localhost bypass; `check` proves torrents exit via Proton. |
| `scripts/on-box.sh` | Pipes one of the Python helpers below to the box and runs it there. |
| `scripts/bazarr-setup.py` | Bazarr's \*arr connections, language profile, providers. Idempotent. |
| `scripts/jellyseerr-repoint.py` | Move Jellyseerr to a different Jellyfin, relinking accounts. |
| `scripts/jellyseerr-telegram.py` | Wire the Telegram agent, to a person or a group. |

Nothing is installed on the box beyond a folder of two files — `~/mediarr/compose.yml` and
`~/mediarr/.env`. Everything else is Docker volumes.

## Deploy

**Push to `main`** — see [Deploying](../../README.md#deploying). Dokploy's `mediarr` app
(`mediarr-uvnh8c`; every `mediarr_*` volume is pinned by name, so all config carried over) runs
compose from its checkout in `/etc/dokploy/compose/mediarr-uvnh8c/code/stacks/mediarr`, with `MEDIA_ROOT`, `PUID`/`PGID`, `TZ`,
`RENDER_GID` and `NAS_TAILNET_IP` from its Environment tab. The local `.env` only tells the helper
scripts which host to ssh to.

```sh
./scripts/deploy.sh            # deploy main now (needs .dokploy.env)
./scripts/wire.sh              # root folders, Prowlarr -> Radarr/Sonarr
```

`deploy.sh` also takes `pull`, `down`, `logs`, or any raw compose arguments, always against
Dokploy's checkout.

The Python helpers run **on the box** — they read API keys out of the containers and call
APIs that are only published on the box's LAN interface. `on-box.sh` pipes them over SSH, so
the repo stays the only copy and there is nothing installed to drift:

```sh
./scripts/on-box.sh bazarr-setup.py
./scripts/on-box.sh jellyseerr-repoint.py <jellyfin-api-key> http://$NAS_TAILNET_IP:8899
./scripts/on-box.sh jellyseerr-telegram.py <bot-token> [chat-id]
```

`wire.sh` skips whatever already exists, so re-running it after a rebuild is safe. It does the
parts with no decisions in them: root folders, and registering Radarr and Sonarr as Prowlarr
applications. Indexers and the Jellyseerr wizard need a human.

## Torrents go through a VPN

Live since 2026-09-26. qBittorrent has no network of its own. It runs in `gluetun`'s network
namespace (`network_mode: service:gluetun`), and gluetun holds a ProtonVPN Plus WireGuard tunnel.
Peers and trackers see a Proton exit IP, never the home line. Only torrents go through it:
Jellyfin, Tailscale, the Cloudflare tunnels and the \*arrs' indexer searches all stay on the home
line, on purpose. Proxying the indexers was considered and dropped: they share nothing with a
swarm, and Nyaa and TPB sit behind Cloudflare, which challenges VPN exits far more often.

- **Firewall.** gluetun's firewall allows nothing out except the tunnel. If the VPN drops,
  torrents stop; they do not fall back to the real IP. qBittorrent is also bound to `tun0`.
- **Port forwarding.** Only Proton's P2P servers forward a port (`PORT_FORWARD_ONLY=on`), and
  Proton picks a new one on every connect. gluetun's up command writes it into qBittorrent's
  `listen_port` over the WebUI API. That call comes from `127.0.0.1` with no login, so
  qBittorrent needs **`bypass_local_auth` on** (`vpn.sh prep`, done). The down command binds
  qBittorrent to `lo` with port 0. gluetun logs the up call as `ERROR ... -> "-" [1]`: that is
  wget's success line arriving on stderr, not a failure.
- **Names and ports stay the same.** gluetun publishes `8080` (WebUI and Swarm) and carries the
  network alias `qbittorrent`, so Radarr and Sonarr keep `qbittorrent:8080`. 6881 is no longer
  published, and its FRITZ!Box rules were deleted. The `debian` device entry stays there, with
  *Abilitazione porte automatica* ticked: its one mapping is most likely Tailscale's.
- **The router's NAT table stops mattering.** Every peer connection is inside one WireGuard flow,
  so the FRITZ!Box tracks one session, not one per peer. The low `ConnectionSpeed=5` can go up.
- **After gluetun restarts**, qBittorrent is stuck in the old namespace with only loopback. Its
  healthcheck requires `eth0`, so it goes unhealthy and `heal.sh` restarts it. `eth0`, not
  `tun0`: `tun0` is also missing while the kill switch holds the tunnel down, and that is not a
  reason to restart anything.

### The kill switch

The hub's `/media` page has a kill switch on the ProtonVPN card, behind a confirmation dialog
(actions `vpn.kill-switch` and `vpn.release`, both in the audit log). Engaging it calls
`PUT /v1/vpn/status {"status":"stopped"}` on gluetun's control API. The tunnel goes down and
the firewall stays up, so qBittorrent keeps running with nowhere to send a byte. Measured before
it was wired to a button: held down for 90 s, qBittorrent could reach nothing (`000` on every
request), gluetun stayed **healthy** (so `heal.sh` does not undo it), and releasing it was back
with a new exit and forwarded port in 5 s, with qBittorrent rebound to `tun0` by the up command.

It is not persistent. Anything that restarts gluetun, like a mediarr redeploy or a reboot,
brings the tunnel back up.

### gluetun's control API

The hub reads it for the VPN card and writes it for the kill switch.

- **One key, four routes.** `GLUETUN_API_KEY` goes into the `gluetun-auth` role file (compose
  `configs:`): `GET`/`PUT /v1/vpn/status`, `GET /v1/publicip/ip`, `GET /v1/portforward`.
  Everything else is private, including `/v1/vpn/settings`, which would hand out the WireGuard
  private key. Verified: every route is `401` without the key, and settings stays `401` with it.
- **Bridge address only.** It is published on `172.17.0.1:8001`, which is what the hub's
  `homelab-host` resolves to. Docker's published ports skip UFW, so a plain `8001:8000` would be
  open to the LAN and the tailnet.
- **The same key lives in two places:** mediarr's and the hub's Dokploy Environment tabs. The
  hub's `collect-env.sh` reads it back out of `/gluetun/auth/config.toml`.

### Credentials

Both live in Dokploy's Environment tab for `mediarr-uvnh8c` and in the local gitignored `.env`:

- `WIREGUARD_PRIVATE_KEY`. Get it from account.protonvpn.com -> Downloads -> WireGuard
  configuration: platform *Router*, **NAT-PMP (Port Forwarding) on**, **Moderate NAT off**, any
  P2P server. Use only the `PrivateKey` line; gluetun chooses the server. `VPN_SERVER_COUNTRIES`
  is optional.
- `GLUETUN_API_KEY`, from `openssl rand -hex 24`.

### Checking it

`./scripts/vpn.sh check` passes only if gluetun is healthy, qBittorrent exits on an IP that is not
the box's, and `listen_port` matches the port Proton forwarded, bound to `tun0`. For a
torrent-level check, add ipleak.net's *Torrent Address detection* magnet. Its random ID is not a
valid infohash, so use a 40-character hex one. Its tracker must report only the Proton IP. That
passed on 2026-09-26.

To back out, revert the VPN commits and push. qBittorrent returns to the host network on 6881,
and the FRITZ!Box forward has to be added again.

## Staying up

Three layers, because each one catches what the one below it misses.

| Layer | Catches |
|---|---|
| `restart: unless-stopped` | The process inside a container exiting. Docker restarts it immediately. |
| `mediarr.service` | A reboot, and a stack that was left stopped. Runs `docker compose up -d` at boot, from Dokploy's checkout. |
| `mediarr-heal.timer` | A container that is *running but wedged* — qBittorrent still alive, Web UI not answering. |

The third one is the interesting case. Docker's restart policy only ever reacts to a process
exiting; a qBittorrent that has hung keeps its container "up" indefinitely and nothing notices.
Every service therefore carries a healthcheck that hits its own HTTP endpoint, and `heal.sh`
turns an `unhealthy` verdict into a `docker restart`. It also puts the stack back if a service
has vanished entirely — someone ran `docker compose down`, a container got removed.

Install both units once:

```sh
./scripts/install-service.sh     # prompts for sudo on the box
```

Check on them:

```sh
ssh homelab 'systemctl status mediarr.service --no-pager; systemctl list-timers mediarr-heal.timer'
ssh homelab 'journalctl -t mediarr-heal --since -1d'
```

`heal.sh` logs every action it takes to the journal under the `mediarr-heal` tag, so a container
that keeps wedging leaves a trail rather than silently bouncing.

Docker itself is already `enabled` at boot on the box, which is what makes all of this hold.

## Where the files live

Every service mounts `MEDIA_ROOT` at the same path, `/data`. That is the detail worth getting
right: identical mounts across containers let Radarr **hardlink** a finished download into the
library instead of copying it, so a seeding torrent and the library file are one set of bytes.

```
/home/davide/media/torrents          qBittorrent's downloads
/home/davide/media/library/movies    Radarr's library
/home/davide/media/library/tv        Sonarr's library
```

All of that is on the box. Bazarr writes its `.srt` files there, and Radarr and Sonarr file the
videos; nothing else does.

The Jellyfin that serves it is on the **NAS**, which is not on this LAN — it advertises a
192.168.15.x address but sits on another network, reachable only over Tailscale. So the library
is *copied* rather than mounted: `~/xfer-nas-auto.sh`, on a ten-minute user timer, hands every
new folder to `~/xfer-nas.sh`, which copies it resumably and verifies it by md5, then the NAS
Jellyfin picks it up from `/volume1/test/{movies,tv}`. Nothing is deleted from this box, so a
finished download keeps seeding here while it plays from there.

The NAS is the constraint: 63 GB free against a 543 GB library. The timer logs `FULL` and skips
rather than overfilling it.

## Wiring, in order

`deploy.sh` and `wire.sh` cover everything except these.

1. **qBittorrent** (`:8080`). Log in as `admin` with the temporary password from
   `docker logs qbittorrent`, set a real one under *Options → Web UI*, and set the save path
   under *Options → Downloads* to `/data/torrents`. Then hand it to the \*arrs:
   ```sh
   QBIT_PASS=yourpassword ./scripts/wire.sh
   ```
2. **Prowlarr** (`:9696`). Create its login, then add indexers under *Indexers → Add Indexer*.
   Prowlarr ships definitions for hundreds of them but no accounts and no defaults — which ones
   is your call. They sync to Radarr and Sonarr automatically from there.
3. **Jellyseerr** (`:5055`). Sign in with **Use your Jellyfin account**:
   - Jellyfin URL: `http://192.168.15.126:8096` — the shim, which lands on the NAS. Going
     straight to `${NAS_TAILNET_IP}:8899` fails with 401: see the shim note above.
   - Verify afterwards that the stored `serverId` is `c5dcde12661c4668acd640f2499b084f`, the
     NAS's. `./scripts/on-box.sh jellyseerr-repoint.py <key> <url>` moves it if it is wrong.
   - Then *Settings → Services*: add Radarr at `radarr:7878` and Sonarr at `sonarr:8989` —
     service names, since all five share one compose network. API keys come from `wire.sh`, or:
     ```sh
     ssh homelab 'for s in radarr sonarr prowlarr; do echo -n "$s: "; \
       docker exec $s sh -c "grep -o \"<ApiKey>[^<]*\" /config/config.xml | cut -d\> -f2"; done'
     ```
   - Tick **Enable Scan** on each, so Jellyseerr flips a request to *Available* once Jellyfin
     reports the file. Note that this now happens only after `xfer-nas-auto` has copied the
     folder to the NAS — a finished download is *Processing* until then, not *Available*.

## Not through Dokploy

The box runs Dokploy, and the monitoring stack is a Dokploy app. This one is plain
`docker compose` over SSH instead: seven services with published LAN ports and no need for
Traefik routing or TLS, so the extra layer would only get in the way. Moving it later is a
paste job — `compose.yml` is self-contained apart from `.env`.

The ports are published on the LAN with no authentication in front of them. That is fine on a
trusted home network and nowhere else; do not forward them, and put Jellyseerr behind the
Cloudflare Tunnel and Access if it ever needs to be reachable from outside.
