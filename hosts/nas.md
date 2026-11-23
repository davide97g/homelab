# The NAS

Ilario's UGREEN NASync **DXP4800 Pro** — `DXP4800PRO-21AF`, Linux 6.18.15, UGOS Pro.
It is **at his house, not on this LAN**. There is no route to it except Tailscale.

| | |
|---|---|
| Tailscale IP | `${NAS_TAILNET_IP}` (node `dxp4800pro-21af`) |
| Account there | `davide` |
| Alias | `ssh nas`, on both the Mac and the box |
| Storage | `/volume1` 11 T (new pool, 2026-10-01); `/volume2` 939 G, docker configs only |
| Home quota | `/home/davide` is capped at **25 G** — not a place to put a library |
| Shares | `/volume1/docker`, `/volume1/media/{Movies,tv}`, `/volume1/test` (empty). Owned by `ilario`; `davide` writes through an ACL (`setfacl u:davide:rwx`, default ACL too) |

An older `Host nas` in the Mac's `~/.ssh/config` pointed at `192.168.15.129` as user
`ilario`, from when the NAS was on this LAN. That address answers nothing now and the
entry was replaced rather than kept alongside.

## Two tailnets, one shared node

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

## Its Jellyfin, on the public internet

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

That hostname serves [Cinema](apps/cinema/), the custom front end, from the `cinema-web`
container on `:8898`. **Jellyfin itself is no longer published on its own hostname**: as of
2026-09-17 `jellyfin.davideghiotto.it` is gone from both the tunnel and DNS, and Jellyfin is
reached under `https://cinema.davideghiotto.it/jf` — which is a complete Jellyfin base URL, so
native clients take it verbatim and the admin UI is at `/jf/web/`. On the LAN it is still
`:8899` as before.

To put the old hostname back: add an ingress rule `jellyfin.davideghiotto.it` ->
`http://localhost:8899` (before the catch-all) and a proxied CNAME to the tunnel.

**There is no second Cinema any more.** From 2026-09-19 the mini PC ran its own Jellyfin (`:8097`)
and `cinema-web` (`:8898`) as `home-cinema.davideghiotto.it`, for the library the then-full NAS
could not hold. All of it — containers, volumes, the Dokploy app, the tunnel route and the DNS
record — was removed on 2026-10-10; the NAS is the only Jellyfin.

| | |
|---|---|
| Tunnel | `nas-ilario`, `<nas-tunnel-uuid>` |
| Ingress | `cinema.davideghiotto.it` -> `http://localhost:8898`, `memories.davideghiotto.it` -> `http://localhost:2284` (2026-11-10, [memories](apps/memories/)), managed in Zero Trust |
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

### Why it is a root service on the root filesystem

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

### sudo on this NAS

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

## Transferring to it

`~/ops/xfer-nas/xfer-nas.sh` on the box. Defaults to one film; point it anywhere with `SRC`.
Films go to `/volume1/media/Movies` (capital M), series to `/volume1/media/tv`. Measured
2026-10-01 over Tailscale: ~24 MB/s, so a 56 GB 4K film is ~40 min plus ~8 min of md5.

```sh
ssh -t homelab "NAS_DEST=/volume1/media/Movies ~/ops/xfer-nas/xfer-nas.sh"
ssh -t homelab "SRC='/path/to/folder' NAS_DEST=/volume1/media/Movies ~/ops/xfer-nas/xfer-nas.sh"
```

```
progress    tail -f ~/ops/xfer-nas/xfer-nas.log
live rate   tail -c 200 ~/ops/xfer-nas/xfer-nas.log.raw
last line   cat ~/ops/xfer-nas/xfer-nas.status
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

## What it actually runs at

First real transfer, 2026-09-14: 6.9 G in **6m 14s**, ~20 MB/s average and 22.4 MB/s
sustained, single attempt, no retries, both md5s matched.

That is ~180 Mbps, comfortably above the 121 Mbps `networkQuality` reported for this
uplink — so treat that figure as pessimistic rather than as the ceiling. The transfer did
**not** collapse the way UGREEN's own web uploader did, and no rate cap was needed. If a
future transfer does start collapsing, the fix is a `--rate-limit`-style cap at roughly
85–90% of whatever the line is doing: capping below line rate keeps the router's upstream
buffer empty and raises the average. Measured bufferbloat here is real — idle latency
28.8 ms, 229.2 ms under load.

## Not possible as things stand (2026-09, before the pool rebuild)

Superseded: since 2026-10-01 `/volume1` is a new 11 T pool and the whole library fits.

The movie library is **301 G** and `/volume1` has **~233 G** free after the first film. The
whole library does not fit. Individual films do.

---

## History: when the NAS was on this LAN

The notes below predate 2026-09-14, when the NAS moved to Ilario's house. The LAN address,
the `ilario` SSH user and the web UI on `:9999` no longer apply.

## UGREEN DXP4800 Pro NAS

### Device

| | |
|---|---|
| Model | UGREEN DXP4800 Pro (UGOS Pro) |
| Hostname | `DXP4800PRO-21AF` |
| LAN IP | `192.168.15.129` |
| Web UI | http://192.168.15.129:9999 |
| SSH user | `ilario` |
| CPU / OS | 8 cores, x86_64, Linux 6.18 |

### SSH access

Alias configured in `~/.ssh/config` on the Mac:

```
Host nas
    HostName 192.168.15.129
    User ilario
    IdentityFile ~/.ssh/id_ed25519
```

Public key is installed on the NAS, so login is passwordless:

```bash
ssh nas
```

Root shell (asks for ilario's password):

```bash
sudo -i
```

#### Enable / keep SSH on

Web UI: **Control Panel > Terminal > SSH**

- Check **Enable**, port `22`.
- Set **Shut down automatically** to **Never**. Any other value disables SSH after that delay and `ssh nas` will stop working.
- Click **Apply**.

Quick reachability check from the Mac:

```bash
nc -z -w 3 192.168.15.129 22
```

### Basics

```bash
uptime                      # load / uptime
df -h                       # disk usage
ps -eo pcpu,comm --sort=-pcpu | head   # top CPU processes
docker ps                   # running containers (ilario is in docker group, no sudo needed)
docker restart jellyfin         # restart Jellyfin (container name)
```

Apps installed via UGOS App Center: Docker, Jellyfin.

### Notes

- Web UI is HTTP only on LAN (browser shows "Not Secure"); fine inside the home network.
- Recommended by UGOS: strong password + enable **auto block** (Control Panel > Security) when SSH is on.

### Jellyfin

| | |
|---|---|
| URL | `http://${NAS_TAILNET_IP}:8899` (Tailscale); public at `https://cinema.davideghiotto.it/jf/web/` |
| Container | `jellyfin` (jellyfin/jellyfin:12.1, runs as `1000:1000`), maps 8096 -> 8899; compose in `/volume1/docker/jellyfin-app` |
| Config on NAS | `/volume2/docker/jellyfin/config` |
| Media mounts | `/volume1/media/Movies` -> `/data/Movies`, `/volume1/media/tv` -> `/data/tv`, `/volume1/test` at the same path (empty) |
| Server | `nasilario`, Id `5507158da22a4b568fec59ecb9887109` |
| Admin | `root` — password `JELLYFIN_NAS_ROOT_PASSWORD`, API key `JELLYFIN_NAS_TOKEN`, both in the root `.env` |
| Libraries | `Shared Movies` = `/data/Movies`, `Shows` = `/data/tv`, realtime monitor on |
| Transcoding | Intel QSV on `/dev/dri/renderD128` (i3-1315U, iHD driver); HW decode h264/hevc/mpeg2/vc1/vp8/vp9/av1 incl. 10-bit; OpenCL tone-mapping on; temp in `/transcode-tmp` |

#### Rebuilt on 2026-10-01

A new 11 TB pool became `/volume1`; the old 939 GB disk is now `/volume2` and holds only the
docker configs. Everything that had been copied to the old `/volume1/test/{movies,tv}` is gone,
and Jellyfin came back as a fresh install with its first-run wizard open — anyone who could
reach 8899 could have claimed the admin account. The wizard was finished over its API the
same day (`/Startup/*`, then `/Auth/Keys` and `/Library/VirtualFolders`). After any reinstall,
check `/System/Info/Public` for `StartupWizardCompleted` straight away.

What else that day needed:

- **Write access for `davide`.** The new folders are `ilario` 755. A UGOS *Admin* role does not
  change that; it only puts `davide` in sudoers. Granted with an ACL, owner left alone:
  `sudo setfacl -R -m u:davide:rwx,d:u:davide:rwx,d:u:1000:rwx /volume1/media /volume1/test`.
  The default entries make every copied file readable by Jellyfin's uid 1000.
- **The tv mount.** The compose file had none. Its directory is not writable by `davide`, so
  `sed -i` fails creating its temp file — write through sudo instead:
  `sudo tee docker-compose.yml < edited-copy`, then `docker compose up -d`.
- **Transcoding.** A fresh install defaults to no hwaccel and decodes only h264/vc1; the
  settings above were POSTed to `/System/Configuration/encoding`. A 4K -> 1080p `h264_qsv`
  test runs at ~83 fps.
- **Seerr** relinked with `stacks/mediarr/scripts/jellyseerr-repoint.py`; jarvis and hub
  need the new key in their Dokploy env.

sudo there needs a tty and the UGOS account password (`NAS_PASSWORD` in the root `.env`).

Library/scan changes without UI: Jellyfin REST API with header `Authorization: MediaBrowser Token="<api key>"` (12.x answers 401 to `X-Emby-Token`).
