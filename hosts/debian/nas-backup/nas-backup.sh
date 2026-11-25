#!/usr/bin/env bash
# Nightly backup of the NAS's irreplaceable data to the mini PC, run from the box.
#
# One ssh session to the NAS carries everything: restic runs there (nas-run.sh) and
# speaks its rclone protocol over the session's stdin/stdout to `rclone serve restic
# --stdio --append-only` running here, on the repository in ~/nas-backup. The NAS
# holds no key to the box. Retention runs here afterwards, and the run writes
# ~/ops/metrics/nas-backup.prom for the NasBackupFailed / NasBackupStale alerts.
set -euo pipefail
STATE="$HOME/ops/nas-backup"
REPO="$HOME/nas-backup"
METRICS="$HOME/ops/metrics"
RESTIC_IMAGE="restic/restic:0.18.1"
RCLONE_IMAGE="rclone/rclone:1.71.1"
set -a; . "$HOME/.config/homelab/nas-restic.env"; set +a

mkdir -p "$STATE" "$METRICS" "$HOME/.cache/restic"
exec 9>"$STATE/lock"; flock -n 9 || { echo "already running"; exit 0; }
started=$(date +%s); added=0

write_metrics() {
  local code=$1 tmp="$METRICS/nas-backup.prom.$$"
  ssh -o BatchMode=yes nas 'rm -f /tmp/nas-backup.env' 2>/dev/null || true
  cat >"$tmp" <<PROM
# HELP homelab_nas_backup_last_run_timestamp_seconds Start of the last NAS backup run.
# TYPE homelab_nas_backup_last_run_timestamp_seconds gauge
homelab_nas_backup_last_run_timestamp_seconds $started
# HELP homelab_nas_backup_last_success_timestamp_seconds End of the last NAS backup run that exited 0.
# TYPE homelab_nas_backup_last_success_timestamp_seconds gauge
homelab_nas_backup_last_success_timestamp_seconds $(cat "$STATE/last-success" 2>/dev/null || echo 0)
# HELP homelab_nas_backup_last_exit_code Exit code of the last NAS backup run.
# TYPE homelab_nas_backup_last_exit_code gauge
homelab_nas_backup_last_exit_code $code
# HELP homelab_nas_backup_last_added_bytes New data the last run added.
# TYPE homelab_nas_backup_last_added_bytes gauge
homelab_nas_backup_last_added_bytes $added
PROM
  mv "$tmp" "$METRICS/nas-backup.prom"
}
trap 'write_metrics $?' EXIT

local_restic() {
  docker run --rm -i --user "$(id -u):$(id -g)" -e RESTIC_PASSWORD \
    -v "$REPO:/repo" -v "$HOME/.cache/restic:/cache" -e RESTIC_CACHE_DIR=/cache \
    "$RESTIC_IMAGE" -r /repo/repo "$@"
}

# The password goes to a 600 file in the NAS's tmpfs /tmp for the length of the run.
printf 'RESTIC_PASSWORD=%s\n' "$RESTIC_PASSWORD" | ssh -o BatchMode=yes nas 'umask 077; cat > /tmp/nas-backup.env'

coproc RCLONE { docker run --rm -i --user "$(id -u):$(id -g)" -v "$REPO:/data" "$RCLONE_IMAGE" \
  serve restic --stdio --append-only /data/repo 2>>"$STATE/rclone.log"; }
ssh -T -o BatchMode=yes -o ServerAliveInterval=20 -o ServerAliveCountMax=6 nas \
  'bash /volume1/docker/nas-backup/run.sh' <&"${RCLONE[0]}" >&"${RCLONE[1]}" 2>"$STATE/last-run.log"
# This shell still holds the write end of rclone's stdin. Close it, or `rclone serve
# --stdio` never sees EOF and the wait below hangs until TimeoutStartSec kills the
# run -- which is what kept every run from 2026-11-24 on from ever reporting success.
rclone_in=${RCLONE[1]}; exec {rclone_in}>&-
wait "$RCLONE_PID" 2>/dev/null || true

summary=$(grep '"message_type":"summary"' "$STATE/last-run.log" | tail -n 1)
[ -n "$summary" ] || { tail -n 5 "$STATE/last-run.log" >&2; exit 1; }
added=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("data_added",0))' "$summary")
echo "NAS snapshot done, $added bytes added"

# A run killed mid-backup (reboot, Docker upgrade) leaves its lock behind. backup only
# takes a shared lock and carries on, but forget needs an exclusive one and fails
# forever. unlock removes only stale locks, and the flock above means no other run
# is live.
local_restic unlock
local_restic forget --tag nightly --keep-daily 7 --keep-weekly 5 --keep-monthly 12
if [ "$(date +%u)" = 7 ]; then
  local_restic prune
  local_restic check --read-data-subset=5%
fi
date +%s >"$STATE/last-success"
