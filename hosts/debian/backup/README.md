# Backup: the mini PC to the NAS, every night

restic, encrypted, deduplicated, to `/volume1/docker/homelab-backup` on the NAS over sftp on
Tailscale. Installed 2026-11-23. Before this, the only copies of the box's data were on the box's
own single NVMe (`~/backups/` included).

## What is in a snapshot

| Path in the snapshot | On the box | Left out |
|---|---|---|
| `/data/home` | `/home/davide` | `media`, `Downloads`, `.cache`, ciamioncino's `overpass-db`, `builder-cache`, `downloads`, atlante's `tiles` and `valhalla` (built on the Mac), echo-demo's `hf` model cache, every `node_modules` and `.venv` |
| `/data/volumes` | `/var/lib/docker/volumes` | `ollama` (re-pullable), Prometheus and Loki data, `mon-test_*`, Jellyfin cache, **and every live Postgres data volume** (dumped instead) |
| `/data/dokploy` | `/etc/dokploy` (compose checkouts with their `.env`, Traefik config, Dokploy's ssh keys) | `logs` |
| `/data/home/ops/backup/dumps/*.sql.gz` | `pg_dumpall` of every running Postgres, taken just before the snapshot | |

A Postgres server is any running container with a volume at `/var/lib/postgresql[/data]` that
answers `pg_isready`. New apps are picked up without touching this script. If a dump fails, that
server's volume goes into the snapshot as raw files and the run is marked failed.

The first run was ~20 GB. Retention: 7 daily, 5 weekly, 12 monthly. On Sundays it also prunes
and reads back 5% of the pack data (`restic check --read-data-subset=5%`).

## Pieces

| File | Where it goes | Role |
|---|---|---|
| `backup.sh` | `~/ops/backup/` | Dumps, snapshot, retention, metrics. restic runs as `restic/restic:0.18.1` in a throwaway container, so it reads root-owned paths without sudo |
| `homelab-backup.service` | `~/.config/systemd/user/` | Oneshot, idle I/O priority |
| `homelab-backup.timer` | same | 03:30 ± 15 min, `Persistent=true` |
| `install.sh` | | Creates the password and the repository on first install |

## The password

Four copies, same value:

- `~/.config/homelab/restic-password` on the box (600) — the file `backup.sh` reads;
- `~/.config/homelab/restic.env` on the box (600), with `RESTIC_REPOSITORY`, beside the other
  credential sets (FRITZ!Box, AdGuard);
- Mac Keychain, service `homelab-restic`, account `davide`
  (`security find-generic-password -s homelab-restic -a davide -w`);
- `RESTIC_PASSWORD` in the repo's gitignored `.env` on the Mac.

All four live on machines this backup is meant to outlive; a copy in a password manager is still
worth having. Without it the repository cannot be opened.

## Alerts

Every run writes `~/ops/metrics/backup.prom`; node-exporter reads it (textfile collector) and
Prometheus fires `BackupFailed`, `BackupStale` (no success in 30 h) and `BackupMetricsMissing`
to Telegram through Alertmanager (`apps/monitoring`).

## Install

```sh
scp -r hosts/debian/backup homelab:/tmp/ && ssh homelab 'bash /tmp/backup/install.sh'
```

## Run, look, restore

```sh
ssh homelab systemctl --user start homelab-backup          # run now
ssh homelab journalctl --user -u homelab-backup -n 50       # last run

# A restic shell on the box: same container, same mounts
ssh homelab
r() { docker run --rm -it --hostname debian \
  -e RESTIC_REPOSITORY="sftp:davide@$(ssh -G nas | awk '$1=="hostname"{print $2}'):/docker/homelab-backup" \
  -e RESTIC_PASSWORD_FILE=/pw -v ~/.config/homelab/restic-password:/pw:ro -v ~/.ssh:/ssh:ro \
  -v ~/restore:/restore restic/restic:0.18.1 \
  -o sftp.command="ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=/ssh/known_hosts davide@$(ssh -G nas | awk '$1=="hostname"{print $2}') -s sftp" "$@"; }
r snapshots
r ls latest /data/volumes/hub_hub-data
r restore latest --target /restore --include /data/volumes/hub_hub-data
```

Files come back owned by root under `~/restore`. A database comes back from its dump:
`gunzip -c <name>.sql.gz | docker exec -i <container> psql -U <user> postgres`.

## Things to know

- UGOS's sftp server roots each session at the shares, so the repository is
  `/docker/homelab-backup` over sftp and `/volume1/docker/homelab-backup` in a shell. The
  directory is `700 davide` with the share's ACL stripped; `/volume1/docker` itself is `777`.
- The NAS is Ilario's and in his house: this is off-box, not off-site in the sense of
  "independent of a person". The second copy, on Backblaze B2, is [`../offsite`](../offsite/).
- A UGOS update wiped the NAS root overlay once (2026-11-08). `/volume1` survived it, which is
  why the repository is there and not under `/home`.
