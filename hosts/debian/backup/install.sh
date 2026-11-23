#!/usr/bin/env bash
# Install the nightly backup on the mini PC, as davide (user units, no sudo):
#   scp -r hosts/debian/backup homelab:/tmp/ && ssh homelab 'bash /tmp/backup/install.sh'
#
# First install creates the restic password and the repository. Copy the
# password off the box (README, "The password") -- without it the backup is noise.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dest="$HOME/ops/backup"
units="$HOME/.config/systemd/user"
pw="$HOME/.config/homelab/restic-password"

mkdir -p "$dest" "$units" "$HOME/ops/metrics" "$(dirname "$pw")"
install -m 0755 "$here/backup.sh" "$dest/"
install -m 0644 "$here/homelab-backup.service" "$here/homelab-backup.timer" "$units/"

if [ ! -s "$pw" ]; then
  umask 077
  head -c 32 /dev/urandom | base64 | tr -d '\n=' >"$pw"
  echo "created $pw -- copy it off the box now"
fi
chmod 600 "$pw"

# Same container invocation as backup.sh, for the one-off init.
nas_host=$(ssh -G nas | awk '$1 == "hostname" { print $2 }')
nas_user=$(ssh -G nas | awk '$1 == "user" { print $2 }')
docker run --rm -e RESTIC_REPOSITORY="sftp:$nas_user@$nas_host:/docker/homelab-backup" \
  -e RESTIC_PASSWORD_FILE=/run/restic-password -v "$pw:/run/restic-password:ro" \
  -v "$HOME/.ssh:/ssh:ro" restic/restic:0.18.1 \
  -o sftp.command="ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=/ssh/known_hosts $nas_user@$nas_host -s sftp" \
  cat config >/dev/null 2>&1 && echo "repository exists" || \
docker run --rm -e RESTIC_REPOSITORY="sftp:$nas_user@$nas_host:/docker/homelab-backup" \
  -e RESTIC_PASSWORD_FILE=/run/restic-password -v "$pw:/run/restic-password:ro" \
  -v "$HOME/.ssh:/ssh:ro" restic/restic:0.18.1 \
  -o sftp.command="ssh -i /ssh/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=/ssh/known_hosts $nas_user@$nas_host -s sftp" \
  init

systemctl --user daemon-reload
systemctl --user enable --now homelab-backup.timer
systemctl --user list-timers homelab-backup.timer --no-pager
