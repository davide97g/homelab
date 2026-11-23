#!/usr/bin/env bash
# scp -r hosts/debian/host-metrics homelab:/tmp/ && ssh homelab 'bash /tmp/host-metrics/install.sh'
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HOME/ops/host-metrics" "$HOME/.config/systemd/user"
install -m 0755 "$here/host-metrics.sh" "$HOME/ops/host-metrics/"
install -m 0644 "$here/host-metrics.service" "$here/host-metrics.timer" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now host-metrics.timer
systemctl --user start host-metrics.service
grep -v '^#' "$HOME/ops/metrics/host.prom"
