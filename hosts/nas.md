# UGREEN DXP4800 Pro NAS

## Device

| | |
|---|---|
| Model | UGREEN DXP4800 Pro (UGOS Pro) |
| Hostname | `DXP4800PRO-21AF` |
| LAN IP | `192.168.15.129` |
| Web UI | http://192.168.15.129:9999 |
| SSH user | `ilario` |
| CPU / OS | 8 cores, x86_64, Linux 6.18 |

## SSH access

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

### Enable / keep SSH on

Web UI: **Control Panel > Terminal > SSH**

- Check **Enable**, port `22`.
- Set **Shut down automatically** to **Never**. Any other value disables SSH after that delay and `ssh nas` will stop working.
- Click **Apply**.

Quick reachability check from the Mac:

```bash
nc -z -w 3 192.168.15.129 22
```

## Basics

```bash
uptime                      # load / uptime
df -h                       # disk usage
ps -eo pcpu,comm --sort=-pcpu | head   # top CPU processes
docker ps                   # running containers (ilario is in docker group, no sudo needed)
docker restart jellyfin         # restart Jellyfin (container name)
```

Apps installed via UGOS App Center: Docker, Jellyfin.

## Notes

- Web UI is HTTP only on LAN (browser shows "Not Secure"); fine inside the home network.
- Recommended by UGOS: strong password + enable **auto block** (Control Panel > Security) when SSH is on.

## Jellyfin

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

### Rebuilt on 2026-10-01

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
