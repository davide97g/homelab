#!/usr/bin/env bash
# Let unattended-upgrades patch the third-party repos too, and move it out of the backup window.
#   scp hosts/debian/hardening/unattended.sh homelab:ops/ && ssh -t homelab 'sudo bash ~/ops/unattended.sh'
# Idempotent.
#
# Debian's default only takes Debian and Debian-Security. Tailscale, cloudflared and Chrome
# shipped fixes waited for a manual `apt full-upgrade` (AptUpgradesPending). Docker stays
# manual on purpose: its upgrade restarts every container, a running backup included.
#
# apt-daily-upgrade.timer defaults to 06:00 + up to 60 min. A long NAS backup (04:30, over
# Tailscale) can still be running then, and a tailscaled restart would fail it. 02:30 is
# before both backups (03:30, 04:30).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

echo "› unattended-upgrades: also Tailscale, cloudflared, Chrome"
cat >/etc/apt/apt.conf.d/52homelab-unattended <<'CONF'
// Managed by the homelab repo, hosts/debian/hardening/unattended.sh.
// Appends to the Origins-Pattern list of 50unattended-upgrades. Docker is left out on purpose.
Unattended-Upgrade::Origins-Pattern {
        "origin=Tailscale,label=Tailscale";
        "origin=cloudflared,label=cloudflared";
        "origin=Google LLC,label=Google";
};
CONF

echo "› apt-daily-upgrade at 02:30, before the backups"
mkdir -p /etc/systemd/system/apt-daily-upgrade.timer.d
cat >/etc/systemd/system/apt-daily-upgrade.timer.d/homelab.conf <<'CONF'
# Managed by the homelab repo, hosts/debian/hardening/unattended.sh
[Timer]
OnCalendar=
OnCalendar=*-*-* 02:30
RandomizedDelaySec=15m
CONF
systemctl daemon-reload
systemctl restart apt-daily-upgrade.timer

echo "› dry run: what would be upgraded now"
unattended-upgrade --dry-run -d 2>&1 | grep -E "Allowed origins|Packages that will be upgraded|No packages found" || true
systemctl list-timers apt-daily-upgrade.timer --no-pager | head -2
