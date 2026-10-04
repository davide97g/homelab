#!/usr/bin/env bash
# Install nas-sync on the mini PC, as davide (user units, no sudo):
#   scp -r hosts/debian/nas-sync homelab:/tmp/ && ssh homelab 'bash /tmp/nas-sync/install.sh'
#
# First run takes the baseline -- every library file present now is never sent --
# and leaves the switch off. Turn it on from the hub's Actions page.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dest="$HOME/ops/xfer-nas"
units="$HOME/.config/systemd/user"

# The hub bind-mounts control/. It must exist, owned by davide, before the hub
# starts, or Docker creates it as root and neither side can write to it.
mkdir -p "$dest/control" "$units"
install -m 0755 "$here/nas-sync.sh" "$dest/nas-sync.sh"
install -m 0644 "$here/nas-sync.service" "$here/nas-sync.timer" "$here/nas-sync.path" "$units/"

# The folder-level predecessor would send the whole backlog. It stays disabled.
systemctl --user disable --now xfer-nas-auto.timer 2>/dev/null || true

systemctl --user daemon-reload
# One run now, before anything can turn it on: takes the baseline, writes off.
"$dest/nas-sync.sh"
systemctl --user enable --now nas-sync.timer nas-sync.path

echo "baseline: $(wc -l < "$dest/control/baseline.txt") file(s) never sent"
echo "switch:   $(cat "$dest/control/enabled")"
cat "$dest/control/tick.tsv"
systemctl --user list-timers nas-sync.timer --no-pager
