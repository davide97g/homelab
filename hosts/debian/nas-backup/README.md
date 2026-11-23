# NAS backup: Immich, accounts and Jellyfin's config, to the mini PC

Before 2026-11-24 the photos in Immich (42 GB of originals) existed once, on the NAS's pool. The
box's own backup goes *to* the NAS; this is the other direction, so each machine holds a copy of
the other's irreplaceable data.

| In the snapshot | On the NAS | Left out |
|---|---|---|
| `/data/immich` | `/volume1/docker/immich-app/library`: originals (`library`, `upload`), `profile`, and `backups`, Immich's own nightly database dump (02:00) | `thumbs`, `encoded-video` — Immich regenerates them |
| `/data/accounts-backups` | `/volume1/docker/accounts/backups`, accounts' nightly `pg_dump` | the live `pgdata` |
| `/data/memories-upload` | `/volume1/docker/memories-upload` | |
| `/data/jellyfin-config` | `/volume2/docker/jellyfin/config`: users, watch history, settings | `metadata`, `cache`, `log`, `transcodes` |

The repository is `~/nas-backup/repo` on the box (restic, encrypted), excluded from the box's own
backup so the photos do not go back to the NAS every night. Retention 7 daily, 5 weekly,
12 monthly; Sunday prune and a 5% read-back.

## How it travels — the NAS cannot call the box

The NAS's Tailscale runs in userspace mode (`--tun=userspace-networking`): connections *to* the
NAS work, connections *from* it into the tailnet do not, and SSH forwarding is off there too.
So the box opens one ssh session and the whole restic conversation rides on it:

```
box: nas-backup.sh ── ssh nas 'bash run.sh' ──▶ NAS: docker run restic backup /data
       │  stdin/stdout of that session              │ restic's rclone backend runs relay.sh,
       ▼                                            ▼ which copies to and from the session
box: rclone serve restic --stdio --append-only ~/nas-backup/repo
```

The NAS holds no key to the box. The password reaches it per run as a 600 file in its tmpfs
`/tmp`, removed at the end. A first attempt (NAS → box over ssh with a forced-command key) is why
`git log` mentions one; that key was revoked the same night.

Every run writes `~/ops/metrics/nas-backup.prom`: `NasBackupFailed`, `NasBackupStale` (30 h) and
`BackupMetricsMissing` alert through Telegram.

## Pieces

| File | Where | Role |
|---|---|---|
| `nas-backup.sh` | box `~/ops/nas-backup/`, user timer `homelab-nas-backup` 04:30 | Orchestrates, rclone side, retention, metrics |
| `nas-run.sh` | NAS `/volume1/docker/nas-backup/run.sh` | restic side, started only by the box |
| `install.sh` | | Password, repository, copies `run.sh`, enables the timer |

Password: `~/.config/homelab/nas-restic.env` on the box, `NAS_RESTIC_PASSWORD` in the repo `.env`,
Mac Keychain `homelab-nas-restic`. The first run (2026-11-24) moved ~46 GB.

```sh
scp -r hosts/debian/nas-backup homelab:/tmp/ && ssh homelab 'bash /tmp/nas-backup/install.sh'
ssh homelab systemctl --user start homelab-nas-backup
ssh homelab tail -f ops/nas-backup/last-run.log
```

## Restore

On the box, the repository is local:

```sh
ssh homelab
set -a; . ~/.config/homelab/nas-restic.env; set +a
r() { docker run --rm -it -e RESTIC_PASSWORD -v ~/nas-backup:/repo -v ~/restore:/restore restic/restic:0.18.1 -r /repo/repo "$@"; }
r snapshots
r restore latest --target /restore --include /data/immich/library
```

Then copy back to the NAS (`tar | ssh nas 'tar -x -C …'` — rsync does not work against UGOS).
Immich's database comes back from the newest `/data/immich/backups/*.sql.gz` with Immich's own
restore procedure.
