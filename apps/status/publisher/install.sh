#!/usr/bin/env bash
# On the mini PC, as davide (user units, no sudo):
#   scp -r apps/status/publisher homelab:/tmp/status-publisher && ssh homelab 'bash /tmp/status-publisher/install.sh'
# Needs ~/.config/homelab/status.env (STATUS_URL, STATUS_INGEST_TOKEN) -- see apps/status/README.md.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
[ -s "$HOME/.config/homelab/status.env" ] || { echo "missing ~/.config/homelab/status.env" >&2; exit 1; }
mkdir -p "$HOME/ops/status" "$HOME/.config/systemd/user"
install -m 0755 "$here/publish.py" "$HOME/ops/status/"
install -m 0644 "$here/status-publish.service" "$here/status-publish.timer" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now status-publish.timer
systemctl --user start status-publish.service
journalctl --user -u status-publish -n 3 --no-pager
