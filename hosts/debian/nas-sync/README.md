# NAS sync: new library files to the NAS, with a switch

The mini PC downloads and imports; the NAS Jellyfin serves. The NAS is reachable only over
Tailscale, so the library is copied, not mounted (see `docs/media-pipeline.md`). This copies
**files that arrive after it was installed**, one file at a time, and nothing older.

The switch is on the hub: **monitoring.davideghiotto.it › Actions › NAS sync**. Off stops a copy in
progress within two seconds; on resumes it from the same byte. New files queue while it is off.

## What counts as new

`install.sh` runs the script once, which writes `control/baseline.txt`: every library file present
at that moment (131 files on 2026-10-04). Those are never sent, whatever the switch says. Anything
not in the baseline and not in `done.txt` is queued, smallest first, once it has been untouched for
5 minutes — Radarr writes the film, Bazarr adds subtitles a moment later, and each is its own file.

Per file, not per folder, unlike `xfer-nas-auto.sh` before it: a new episode lands in a season
folder that already exists, and only the episode is new.

To send an older title anyway, use `xfer-nas.sh` by hand (root README, *Transferring to it*); while
its tmux session runs, nas-sync waits. To re-baseline (everything present now becomes "old"):
delete `control/baseline.txt`; the next run writes a new one.

## Pieces

| File | Where it goes | Role |
|---|---|---|
| `nas-sync.sh` | `~/ops/xfer-nas/` | The copier. Resume by appending the missing tail over ssh, md5 on both ends. |
| `nas-sync.timer` | `~/.config/systemd/user/` | Every 2 minutes. |
| `nas-sync.path` | same | Runs it the moment the switch file changes, so *on* starts at once. |
| `nas-sync.service` | same | Oneshot, no timeout; a flock in the script prevents overlap. |

`~/ops/xfer-nas/control/` is the whole interface. The hub bind-mounts it at `/nas-sync` and writes
only `enabled` (replaced by rename, so the script never reads half of it). The script writes the
rest: `baseline.txt`, `done.txt`, `queue.tsv`, `current.tsv`, `recent.tsv`, `tick.tsv`, `nas.tsv`.
The hub needs no SSH and no access to systemd. Log: `~/ops/xfer-nas/nas-sync.log`.

## Install

User units, no sudo. Install on the box **before** the hub deploy that adds the mount, or Docker
creates `control/` as root and neither side can write to it.

```sh
scp -r hosts/debian/nas-sync homelab:/tmp/ && ssh homelab 'bash /tmp/nas-sync/install.sh'
```

It disables the old `xfer-nas-auto.timer` (which would send the whole backlog), takes the
baseline, leaves the switch off, and enables the timer and the path unit.

## Things to know

- Nothing is ever deleted, here or on the NAS. A Radarr *upgrade* is a new file with a new name, so
  it is sent, and the old one stays on the NAS next to it until removed by hand.
- A file whose md5 does not match is emptied on the NAS and resent on the next run.
- The NAS full (less than 5 GB headroom after the file) skips that file with `full` in the recent
  list; smaller files after it still go.
- Tested 2026-10-04 in a sandbox: baseline file never sent, switch off at 20 MB of 400 MB, resumed
  from byte 20 480 000, md5 matched.
