#!/usr/bin/env bash
# Install the NAS -> mini PC backup. Run on the box, as davide (no sudo anywhere):
#   scp -r hosts/debian/nas-backup homelab:/tmp/ && ssh homelab 'bash /tmp/nas-backup/install.sh'
# Idempotent. First run creates the password, the repository and the NAS's key.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
RCLONE_IMAGE="rclone/rclone:1.71.1"
RESTIC_IMAGE="restic/restic:0.18.1"
envf="$HOME/.config/homelab/nas-restic.env"
nasdir=/volume1/docker/nas-backup

mkdir -p "$HOME/ops/nas-backup" "$HOME/ops/metrics" "$HOME/nas-backup" "$HOME/.config/systemd/user" "$HOME/.cache/restic"
chmod 700 "$HOME/nas-backup"
install -m 0755 "$here/nas-backup.sh" "$HOME/ops/nas-backup/"
install -m 0644 "$here/homelab-nas-backup.service" "$here/homelab-nas-backup.timer" "$HOME/.config/systemd/user/"
docker pull -q "$RCLONE_IMAGE" >/dev/null && docker pull -q "$RESTIC_IMAGE" >/dev/null

# 1. Password, and the repository, here on the box.
if [ ! -s "$envf" ]; then
  umask 077
  printf '# restic repository of the NAS backup, on the box at ~/nas-backup/repo (hosts/debian/nas-backup).\n# Lost password = lost backup. Same value: Mac Keychain homelab-nas-restic, repo .env NAS_RESTIC_PASSWORD.\nRESTIC_PASSWORD=%s\n' \
    "$(head -c 32 /dev/urandom | base64 | tr -d '\n=/+')" >"$envf"
  echo "created $envf -- copy it off the box"
fi
set -a; . "$envf"; set +a
if [ ! -e "$HOME/nas-backup/repo/config" ]; then
  docker run --rm --user "$(id -u):$(id -g)" -e RESTIC_PASSWORD -v "$HOME/nas-backup:/repo" "$RESTIC_IMAGE" -r /repo/repo init
fi

# 2. The script the box starts on the NAS. /volume1 survives a UGOS update; /home does not.
# Not scp: UGOS's sftp roots at the shares, so /volume1/... does not exist there.
ssh nas "mkdir -p $nasdir && chmod 700 $nasdir && (setfacl -b $nasdir 2>/dev/null || true)"
# Written beside and renamed: a run in progress keeps reading the old file.
ssh nas "cat > $nasdir/run.sh.new && chmod 700 $nasdir/run.sh.new && mv $nasdir/run.sh.new $nasdir/run.sh" <"$here/nas-run.sh"
ssh nas "docker pull -q $RESTIC_IMAGE >/dev/null"

systemctl --user daemon-reload
systemctl --user enable --now homelab-nas-backup.timer
systemctl --user list-timers homelab-nas-backup.timer --no-pager | head -2
