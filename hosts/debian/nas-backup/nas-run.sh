#!/usr/bin/env bash
# Runs ON THE NAS, started by the mini PC's nas-backup.sh over ssh, never on its own.
#
# The NAS cannot open connections into the tailnet (its tailscaled runs with
# --tun=userspace-networking: inbound works, outbound does not), so the restic
# repository is reached through the very ssh session the box opened: this
# script's stdin/stdout ARE the wire to `rclone serve restic --stdio` on the box.
# restic's rclone backend talks to a child process, and that child (relay.sh)
# just copies between restic and fds 3/4, which are this session's stdin/stdout.
# Everything restic prints goes to stderr, which the box logs.
#
# The password is put in /tmp (tmpfs, 600) by the box just before, and removed here.
set -euo pipefail
here=/volume1/docker/nas-backup
pwfile=/tmp/nas-backup.env
trap 'rm -f "$pwfile"' EXIT
mkdir -p "$here/cache"
cat >"$here/relay.sh" <<'RELAY'
#!/bin/sh
cat <&3 &
exec cat >&4
RELAY
chmod 755 "$here/relay.sh"

exec 3<&0 4>&1 1>&2
# One progress line a minute: restic would otherwise print several a second into the box's log.
docker run --rm -i --hostname nas --env-file "$pwfile" -e RESTIC_PROGRESS_FPS=0.0167 \
  -v "$here:/k:ro" \
  -v "$here/cache:/root/.cache/restic" \
  -v /volume1/docker/immich-app/library:/data/immich:ro \
  -v /volume1/docker/accounts/backups:/data/accounts-backups:ro \
  -v /volume1/docker/memories-upload:/data/memories-upload:ro \
  -v /volume2/docker/jellyfin/config:/data/jellyfin-config:ro \
  --entrypoint sh restic/restic:0.18.1 -c '
    exec 3<&0 4>&1 1>&2
    exec restic -r rclone:box:repo -o rclone.program=/k/relay.sh -o rclone.args="" \
      backup --json --tag nightly /data \
      --exclude-caches \
      --exclude /data/immich/thumbs \
      --exclude /data/immich/encoded-video \
      --exclude /data/jellyfin-config/metadata \
      --exclude /data/jellyfin-config/cache \
      --exclude /data/jellyfin-config/log \
      --exclude /data/jellyfin-config/transcodes' <&3 >&4
