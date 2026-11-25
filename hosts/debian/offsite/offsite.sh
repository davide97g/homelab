#!/usr/bin/env bash
# Nightly off-site copy of both restic repositories to Backblaze B2.
#
#   box repo  sftp:NAS:/docker/homelab-backup   (hosts/debian/backup)    -> b2:<bucket>/box
#   NAS repo  ~/nas-backup/repo on the box      (hosts/debian/nas-backup) -> b2:<bucket>/nas
#
# `restic copy` moves only the snapshots B2 does not have yet. The B2 side is
# reached through `rclone serve restic`, in its own container: the B2 key lives
# only in that container's environment, and restic talks to it over the
# container's loopback (restic joins its network namespace). Nothing listens on
# the host.
#
# The B2 application key has no deleteFiles capability. rclone's B2 backend
# hides instead of deleting, and the bucket's lifecycle rule purges hidden files
# after 30 days. So whoever holds this box -- and with it the key -- can make
# the copy look empty but cannot destroy it for a month: the one copy that a
# compromised box cannot wipe. See README.md.
#
# Writes ~/ops/metrics/offsite.prom for the OffsiteBackupFailed / OffsiteBackupStale alerts.
set -euo pipefail

STATE="$HOME/ops/offsite"
METRICS="$HOME/ops/metrics"
RESTIC_IMAGE="restic/restic:0.18.1"
RCLONE_IMAGE="rclone/rclone:1.71.1"
RCLONE_NAME="offsite-rclone"
BOX_PASSWORD_FILE="$HOME/.config/homelab/restic-password"
# RCLONE_CONFIG_B2_ACCOUNT / _KEY (the restricted key), B2_BUCKET, OFFSITE_BWLIMIT.
B2_ENV="$HOME/.config/homelab/b2.env"
set -a; . "$B2_ENV"; set +a
NAS_RESTIC_PASSWORD=$(sed -n 's/^RESTIC_PASSWORD=//p' "$HOME/.config/homelab/nas-restic.env")
NAS_HOST=$(ssh -G nas | awk '$1 == "hostname" { print $2 }')
NAS_USER=$(ssh -G nas | awk '$1 == "user" { print $2 }')

mkdir -p "$STATE" "$METRICS" "$HOME/.cache/restic"
exec 9>"$STATE/lock"; flock -n 9 || { echo "already running"; exit 0; }
started=$(date +%s)
box_snapshots=0
nas_snapshots=0

write_metrics() {
  local code=$1 tmp="$METRICS/offsite.prom.$$"
  docker rm -f "$RCLONE_NAME" >/dev/null 2>&1 || true
  cat >"$tmp" <<PROM
# HELP homelab_offsite_last_run_timestamp_seconds Start of the last off-site copy run.
# TYPE homelab_offsite_last_run_timestamp_seconds gauge
homelab_offsite_last_run_timestamp_seconds $started
# HELP homelab_offsite_last_success_timestamp_seconds End of the last off-site copy run that exited 0.
# TYPE homelab_offsite_last_success_timestamp_seconds gauge
homelab_offsite_last_success_timestamp_seconds $(cat "$STATE/last-success" 2>/dev/null || echo 0)
# HELP homelab_offsite_last_exit_code Exit code of the last off-site copy run.
# TYPE homelab_offsite_last_exit_code gauge
homelab_offsite_last_exit_code $code
# HELP homelab_offsite_snapshots Snapshots in each B2 repository after the last run (0 if unknown).
# TYPE homelab_offsite_snapshots gauge
homelab_offsite_snapshots{repo="box"} $box_snapshots
homelab_offsite_snapshots{repo="nas"} $nas_snapshots
PROM
  mv "$tmp" "$METRICS/offsite.prom"
}
trap 'write_metrics $?' EXIT

# --- The B2 end: rclone serving restic's REST protocol, on its container's loopback only.
docker rm -f "$RCLONE_NAME" >/dev/null 2>&1 || true
docker run -d --name "$RCLONE_NAME" \
  --env-file "$B2_ENV" \
  -e RCLONE_CONFIG_B2_TYPE=b2 \
  -e RCLONE_CONFIG_B2_HARD_DELETE=false \
  "$RCLONE_IMAGE" serve restic "b2:$B2_BUCKET" --addr 127.0.0.1:8000 \
  --bwlimit "${OFFSITE_BWLIMIT:-off}" >/dev/null
for _ in $(seq 30); do
  docker logs "$RCLONE_NAME" 2>&1 | grep -q 'Serving restic' && break
  sleep 1
done

# restic inside rclone's network namespace. $1 is the B2 repository path, the rest restic's args.
restic_b2() {
  local repo=$1; shift
  docker run --rm -i --network "container:$RCLONE_NAME" \
    -e RESTIC_REPOSITORY="rest:http://127.0.0.1:8000/$repo/" \
    -e RESTIC_PASSWORD_FILE=/run/dest-password \
    -v "$HOME/.cache/restic:/root/.cache/restic" \
    -v "$HOME/.ssh:/ssh:ro" \
    -v "$HOME/nas-backup:/nas-backup:ro" \
    "${PASSWORD_MOUNTS[@]}" \
    "$RESTIC_IMAGE" \
    -o sftp.command="ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=/ssh/known_hosts -o ServerAliveInterval=20 -o ServerAliveCountMax=3 $NAS_USER@$NAS_HOST -s sftp" \
    "$@"
}

count_snapshots() {
  restic_b2 "$1" snapshots --json --no-lock | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'
}

# The NAS repo's password sits in an env file; restic wants a file holding only the password.
pwtmp=$(mktemp "$STATE/nas-pw.XXXXXX"); chmod 600 "$pwtmp"
printf '%s' "$NAS_RESTIC_PASSWORD" >"$pwtmp"
trap 'code=$?; rm -f "$pwtmp"; write_metrics $code' EXIT

# Each B2 repository keeps its source's password and chunker parameters, so the
# copy deduplicates exactly like the source and one password opens both.
use_repo() {
  case $1 in
    box) pw=$BOX_PASSWORD_FILE; FROM_REPO="sftp:$NAS_USER@$NAS_HOST:/docker/homelab-backup" ;;
    nas) pw=$pwtmp; FROM_REPO=/nas-backup/repo ;;
  esac
  PASSWORD_MOUNTS=(-v "$pw:/run/dest-password:ro"
    -v "$pw:/run/from-password:ro" -e RESTIC_FROM_PASSWORD_FILE=/run/from-password)
}

# `offsite.sh --init`, from install.sh: create whichever B2 repository is missing, nothing else.
if [ "${1:-}" = --init ]; then
  # No metrics from an init: a last_success of 0 would page as stale at once.
  trap 'rm -f "$pwtmp"; docker rm -f "$RCLONE_NAME" >/dev/null 2>&1 || true' EXIT
  for repo in box nas; do
    use_repo "$repo"
    if restic_b2 "$repo" cat config >/dev/null 2>&1; then
      echo "b2:$B2_BUCKET/$repo exists"
    else
      restic_b2 "$repo" init --from-repo "$FROM_REPO" --copy-chunker-params
    fi
  done
  exit 0
fi

for repo in box nas; do
  use_repo "$repo"
  # --retry-lock: the sources prune on Sundays and hold an exclusive lock meanwhile.
  restic_b2 "$repo" copy --from-repo "$FROM_REPO" --retry-lock 2h
  # A run killed mid-copy leaves a stale lock that would block forget forever.
  restic_b2 "$repo" unlock
  # Same retention as the sources. Prune only on the 1st: on B2 every rewritten
  # pack becomes a hidden file billed for 30 more days, so prune rarely.
  restic_b2 "$repo" forget --keep-daily 7 --keep-weekly 5 --keep-monthly 12
  if [ "$(date +%d)" = 01 ]; then
    restic_b2 "$repo" prune --max-unused 10%
    restic_b2 "$repo" check
  fi
  n=$(count_snapshots "$repo")
  echo "$repo: $n snapshots on B2"
  if [ "$repo" = box ]; then box_snapshots=$n; else nas_snapshots=$n; fi
done

date +%s >"$STATE/last-success"
