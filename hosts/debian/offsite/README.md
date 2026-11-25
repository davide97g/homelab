# Off-site: both restic repositories to Backblaze B2, every night

The box backs up to the NAS ([`../backup`](../backup/)) and the NAS backs up to the box
([`../nas-backup`](../nas-backup/)). The two machines are in different houses, so a fire or a
theft takes one copy, not both. What that pair does not survive is the box itself going bad:
the box holds an ssh key with a full shell on the NAS, and it holds the NAS's repository
locally. Whoever owns the box can delete every copy of everything. This is the copy it cannot.

| B2 path | Copied from | Password |
|---|---|---|
| `<bucket>/box` | `sftp:NAS:/docker/homelab-backup`, the box's repository | the box repo's (`~/.config/homelab/restic-password`) |
| `<bucket>/nas` | `~/nas-backup/repo`, the NAS's repository (Immich, accounts, Jellyfin config) | the NAS repo's (`~/.config/homelab/nas-restic.env`) |

Each B2 repository was created with `--copy-chunker-params`, so it deduplicates exactly like its
source and opens with the same password. `restic copy` sends only the snapshots B2 does not have.
Retention matches the sources (7 daily, 5 weekly, 12 monthly); prune and a metadata `check` run
on the 1st of the month only.

## Why the box cannot delete it

The B2 application key on the box was created with
`listBuckets,listFiles,readFiles,writeFiles,hideFiles`, **without `deleteFiles`**, and only for
this bucket. rclone's B2 backend hides instead of deleting (`hard_delete=false`), and the bucket's
lifecycle rule ("keep prior versions for 30 days") purges a hidden file 30 days later. So with
the key one can make the repository look empty, but every file is still there for 30 days, and
the master key (not on any machine) can unhide it. `forget`/`prune` work the same way: what they
remove is billed for 30 more days, which is why prune is monthly.

`OffsiteBackupFailed`, `OffsiteBackupStale` (30 h) and the snapshot count in
`homelab_offsite_snapshots` are what tells you within that month.

## How it runs

```
offsite.sh ─ docker run rclone serve restic b2:<bucket> --addr 127.0.0.1:8000   (B2 key only here)
           └ docker run --network container:offsite-rclone restic copy
                 --from-repo sftp:NAS:/docker/homelab-backup   -r rest:http://127.0.0.1:8000/box/
                 --from-repo /nas-backup/repo                  -r rest:http://127.0.0.1:8000/nas/
```

restic joins rclone's network namespace, so the REST server is on that container's loopback and
nothing listens on the host. `OFFSITE_BWLIMIT` is rclone's `--bwlimit` (bytes/s, timetable
allowed), so the first upload (~70 GB) does not choke the house's uplink by day.

| File | Where | Role |
|---|---|---|
| `offsite.sh` | box `~/ops/offsite/` | Copy, retention, metrics (`~/ops/metrics/offsite.prom`); `--init` creates the B2 repos |
| `homelab-offsite.service` / `.timer` | `~/.config/systemd/user/`, 06:00 ± 15 min | After the 03:30 and 04:30 backups |
| `install.sh` | | Checks `b2.env`, installs, inits, enables the timer |

## Setup (once)

1. Backblaze account, a **private** bucket, Lifecycle Settings → *Keep prior versions for this
   number of days: 30*.
2. With a temporary master application key, on the Mac:
   ```sh
   uvx --from b2 b2 account authorize
   uvx --from b2 b2 key create --bucket <bucket> homelab-offsite listBuckets,listFiles,readFiles,writeFiles,hideFiles
   ```
   Then delete the master key in the web UI. The B2 web UI cannot make a key without `deleteFiles`.
3. On the box, `~/.config/homelab/b2.env` (600, unquoted values: it is also a `docker --env-file`):
   ```
   RCLONE_CONFIG_B2_ACCOUNT=<keyID>
   RCLONE_CONFIG_B2_KEY=<applicationKey>
   B2_BUCKET=<bucket>
   OFFSITE_BWLIMIT=07:00,3M 01:00,off
   ```
   Same values in the Mac Keychain (`homelab-b2`) and the repo `.env`.
4. `scp -r hosts/debian/offsite homelab:/tmp/ && ssh homelab 'bash /tmp/offsite/install.sh'`

## Run, look, restore

```sh
ssh homelab systemctl --user start homelab-offsite
ssh homelab journalctl --user -u homelab-offsite -n 50
```

Restoring from B2 needs nothing from the box except a password: on any machine with restic
and rclone, point rclone at the bucket (`rclone config` with the restricted key, or the master
key) and run restic against `rclone:b2:<bucket>/box` or `.../nas`, with that repo's password.
If the files were hidden, unhide them first with the master key
(`b2 file unhide b2://<bucket>/<path>`, or a lifecycle-free copy with `rclone copy --b2-versions`).
