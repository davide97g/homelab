#!/usr/bin/env bash
# Install the nightly off-site copy to Backblaze B2. Run on the box, as davide (no sudo):
#   scp -r hosts/debian/offsite homelab:/tmp/ && ssh homelab 'bash /tmp/offsite/install.sh'
# Needs ~/.config/homelab/b2.env first (README.md, "Setup"). Idempotent.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
envf="$HOME/.config/homelab/b2.env"

if [ ! -s "$envf" ]; then
  echo "missing $envf -- see README.md, Setup" >&2
  exit 1
fi
chmod 600 "$envf"
for key in RCLONE_CONFIG_B2_ACCOUNT RCLONE_CONFIG_B2_KEY B2_BUCKET; do
  grep -q "^$key=." "$envf" || { echo "$envf has no $key" >&2; exit 1; }
done

mkdir -p "$HOME/ops/offsite" "$HOME/ops/metrics" "$HOME/.config/systemd/user"
install -m 0755 "$here/offsite.sh" "$HOME/ops/offsite/"
install -m 0644 "$here/homelab-offsite.service" "$here/homelab-offsite.timer" "$HOME/.config/systemd/user/"
docker pull -q rclone/rclone:1.71.1 >/dev/null && docker pull -q restic/restic:0.18.1 >/dev/null

"$HOME/ops/offsite/offsite.sh" --init

systemctl --user daemon-reload
systemctl --user enable --now homelab-offsite.timer
systemctl --user list-timers homelab-offsite.timer --no-pager | head -2
