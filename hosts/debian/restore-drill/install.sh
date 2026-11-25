#!/usr/bin/env bash
# Install the weekly restore drill. Run on the box, as davide (no sudo):
#   scp -r hosts/debian/restore-drill homelab:/tmp/ && ssh homelab 'bash /tmp/restore-drill/install.sh'
# Needs the two backups installed first (their passwords and the NAS ssh alias). Idempotent.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
for f in "$HOME/.config/homelab/restic-password" "$HOME/.config/homelab/nas-restic.env"; do
  [ -s "$f" ] || { echo "missing $f -- install hosts/debian/backup and nas-backup first" >&2; exit 1; }
done
mkdir -p "$HOME/ops/restore-drill" "$HOME/ops/metrics" "$HOME/.config/systemd/user"
install -m 0755 "$here/drill.sh" "$HOME/ops/restore-drill/"
install -m 0644 "$here/homelab-restore-drill.service" "$here/homelab-restore-drill.timer" "$HOME/.config/systemd/user/"
docker pull -q restic/restic:0.18.1 >/dev/null && docker pull -q alpine:3.22 >/dev/null
systemctl --user daemon-reload
systemctl --user enable --now homelab-restore-drill.timer
systemctl --user list-timers homelab-restore-drill.timer --no-pager | head -2
