# NAS deploy: push to main, the box ships it to the NAS

The NAS apps cannot be Dokploy apps (no root Docker there) and GitHub cannot reach the NAS, so until
2026-11-25 they were deployed by hand from the Mac with tar over ssh. Now the box pulls: every
5 minutes `nas-deploy.sh` fetches `main` from the public repo and deploys each app whose folder
changed since its last deploy. Same contract as the Dokploy apps: what is on `main` is what runs.

| App | Folder in the repo | On the NAS | Deploy | Healthy when |
|---|---|---|---|---|
| cinema | `apps/cinema` (minus `apps/ios`, `apps/android`) | `/volume1/docker/cinema` | `docker compose up -d --build` in `services/web` | `:8898/` and `:8898/jf/System/Info/Public` answer |
| memories | `apps/memories` | `/volume1/docker/memories` | web built **on the box** with bun, then compose, nginx.conf, relay.py, search.py and `web/dist` sent; `up -d --force-recreate` | `:2284/` and `:2284/immich/api/server/ping` answer |
| accounts | `apps/accounts` | `/volume1/docker/accounts` | `docker compose up -d --build` | `:2290/api/health` says `"ok":true` |
| nas-agents | `apps/monitoring/nas-agents` | `/volume1/docker/nas-agents` | `docker compose --profile logs up -d` | 4 containers running |

The source is `git archive` of exactly that commit, so nothing untracked (a stray `.env`, `node_modules`,
macOS `._` files) rides along. tar only adds and overwrites on the NAS: `.env`, accounts' `pgdata`,
`backups` and `pipeline/` are never touched, and a file deleted from git stays on the NAS until removed
by hand.

cinema and memories ran from `/home/davide/{cinema,memories}` until 2026-11-25. A UGOS update resets
`/home` (it did on 2026-11-08), so they moved to `/volume1/docker` with their first deploy from here.
The old folders are still in `/home/davide` as a rollback and can go.

## Behaviour

- First run after install marks every app as deployed at the current `main` without touching the NAS
  (the NAS was checked file by file against `main` on 2026-11-25).
- A failed deploy keeps the app at its previous commit and is not retried at the same commit every
  5 minutes; it goes again when `main` moves, or with `--force`. `NasDeployFailed` pages meanwhile.
- `NasDeployLoopStale` fires if the loop has not looked at `main` for an hour.

```sh
ssh homelab '~/ops/nas-deploy/nas-deploy.sh --status'          # deployed commit per app
ssh homelab '~/ops/nas-deploy/nas-deploy.sh --force cinema'    # redeploy main now
ssh homelab 'journalctl --user -u homelab-nas-deploy -n 40'
```

| File | Where | |
|---|---|---|
| `nas-deploy.sh` | box `~/ops/nas-deploy/` (its clone of the repo is `~/ops/nas-deploy/repo`) | the loop; `--run` is its own child mode, see the comment in `deploy()` |
| `homelab-nas-deploy.service` / `.timer` | `~/.config/systemd/user/`, every 5 min | |
| `install.sh` | | `scp -r hosts/debian/nas-deploy homelab:/tmp/ && ssh homelab 'bash /tmp/nas-deploy/install.sh'` |

A change to `nas-deploy.sh` itself ships with `install.sh` again, like the other host scripts.

## Traps

- Files created under `/volume1/docker` inherit the share's ACL, which locks out non-root container
  users: memories' nginx answered 500 (`stat() … Permission denied`) on its first deploy here. The
  memories step strips the ACL (`setfacl -bR`) after every copy.
- `deploy()` runs each app's step as a child process (`nas-deploy.sh --run`), because bash ignores
  `set -e` inside anything called from an `||` list, subshells included: a failed build would have
  carried on and shipped.
