#!/usr/bin/env bash
# Install the NAS push-to-deploy loop. Run on the box, as davide (no sudo):
#   scp -r hosts/debian/nas-deploy homelab:/tmp/ && ssh homelab 'bash /tmp/nas-deploy/install.sh'
# Idempotent. The first run marks every app as deployed at the current main
# without touching the NAS, so check first that the NAS matches main (README).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
command -v bun >/dev/null || { echo "bun is needed to build memories' web app" >&2; exit 1; }
ssh -o BatchMode=yes nas true || { echo "ssh nas does not work from this account" >&2; exit 1; }
mkdir -p "$HOME/ops/nas-deploy" "$HOME/ops/metrics" "$HOME/.config/systemd/user"
install -m 0755 "$here/nas-deploy.sh" "$HOME/ops/nas-deploy/"
install -m 0644 "$here/homelab-nas-deploy.service" "$here/homelab-nas-deploy.timer" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now homelab-nas-deploy.timer
systemctl --user start homelab-nas-deploy.service
"$HOME/ops/nas-deploy/nas-deploy.sh" --status
