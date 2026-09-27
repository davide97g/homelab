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
| URL | http://192.168.15.129:8899 |
| Container | `jellyfin` (jellyfin/jellyfin:12.1), maps 8096 -> 8899; compose in `/volume1/docker/jellyfin-app` |
| Config on NAS | `/volume2/docker/jellyfin/config` |
| Media mounts | `/volume1/media/Movies` -> `/data/Movies`; `/volume1/test` at the same path (`Shared Movies` = `/volume1/test/movies`, `Shows` = `/volume1/test/tv`) |

Drop movies in `/home/ilario/Movies`, then Dashboard > Libraries > Scan All Libraries (or wait, realtime monitor is on).

Library/scan changes without UI: Jellyfin REST API with header `Authorization: MediaBrowser Token="<api key>"` (12.x answers 401 to `X-Emby-Token`) (create in Dashboard > API Keys). Config dir is root-owned, cannot edit from ssh as ilario.
