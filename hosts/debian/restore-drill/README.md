# Restore drill: every Wednesday, both backups are restored for real

`restic check --read-data-subset=5%` (Sundays, in [`../backup`](../backup/) and
[`../nas-backup`](../nas-backup/)) proves the bytes are in the repository. This proves they turn
back into something usable: databases that load and photos that come back whole. Nothing live is
touched: everything happens in throwaway containers labelled `homelab.restore-drill` and in
`~/ops/restore-drill/work`, both removed at the end.

| Target | From | Passes when |
|---|---|---|
| `pg:<container>`, one per dump | box repo, latest snapshot, `~/ops/backup/dumps/*.sql.gz` | the `pg_dumpall` loads into the live server's image (Swarm service image for `dokploy-postgres`; the dump's own major version if the server is gone), as the live `POSTGRES_USER`, every database has tables, and psql printed no error besides `role … already exists` |
| `immich-db` | NAS repo, newest `/data/immich/backups/*.sql.gz` | it loads into an empty `immich` database on the NAS's own Immich Postgres image (with Immich's `search_path` fix) and `asset` has rows |
| `accounts-db` | NAS repo, newest `/data/accounts-backups/*.sql.gz` | it loads into `accounts` on the NAS's image and `"user"` has rows |
| `immich-photos` | NAS repo, 5 random originals (`PHOTO_SAMPLES`) | `restic dump` returns exactly the size recorded in the snapshot |

First run 2026-11-25: 12/12 in about a minute (9 box databases, Immich 9588 assets, accounts, 5 photos).

## Pieces

| File | Where | Role |
|---|---|---|
| `drill.sh` | box `~/ops/restore-drill/` | The drill; writes `~/ops/metrics/restore-drill.prom` |
| `homelab-restore-drill.service` / `.timer` | `~/.config/systemd/user/`, Wednesday 11:00 ± 15 min | |
| `install.sh` | | Installs and enables the timer |

```sh
scp -r hosts/debian/restore-drill homelab:/tmp/ && ssh homelab 'bash /tmp/restore-drill/install.sh'
ssh homelab systemctl --user start homelab-restore-drill     # run now, ~1 min
ssh homelab journalctl --user -u homelab-restore-drill -n 30
```

Alerts: `RestoreDrillFailed` (with the failing targets in `homelab_restore_drill_target_ok`) and
`RestoreDrillStale` (no full pass in 8 days). A failed target's psql output is kept in
`~/ops/restore-drill/errors/<target>.err`.

## Traps it already hit

- restic restores parent directories as root `0700`; the script `chown`s `work/` back before
  reading it.
- A container whose `POSTGRES_USER` is not `postgres` (calorico) has dumps full of grants made
  *as* that role, which fail on a cluster whose superuser is `postgres`.
- Immich v3 dumps only its own database (`pg_dump --clean`), not the cluster: it has to be loaded
  into `immich`, or every table lands in `postgres` and the check finds nothing.
