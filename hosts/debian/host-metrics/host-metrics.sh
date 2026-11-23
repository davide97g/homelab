#!/usr/bin/env bash
# Host facts Prometheus cannot see from inside node-exporter: a pending reboot and
# pending apt upgrades. Written to ~/ops/metrics/host.prom for the textfile collector.
# No sudo: /var/run/reboot-required is world-readable, and `apt list --upgradable`
# reads the package lists apt-daily.timer already refreshes.
set -euo pipefail
dir="$HOME/ops/metrics"; mkdir -p "$dir"
tmp="$dir/host.prom.$$"

if [ -e /var/run/reboot-required ]; then
  reboot=1; since=$(stat -c %Y /var/run/reboot-required)
else
  reboot=0; since=0
fi
upgradable=$(apt list --upgradable 2>/dev/null | tail -n +2 | grep -c . || true)
security=$(apt list --upgradable 2>/dev/null | grep -c -- '-security' || true)

cat >"$tmp" <<PROM
# HELP homelab_reboot_required 1 when /var/run/reboot-required exists.
# TYPE homelab_reboot_required gauge
homelab_reboot_required $reboot
# HELP homelab_reboot_required_since_seconds When the reboot became required (0 if not).
# TYPE homelab_reboot_required_since_seconds gauge
homelab_reboot_required_since_seconds $since
# HELP homelab_apt_upgradable_packages Packages apt would upgrade.
# TYPE homelab_apt_upgradable_packages gauge
homelab_apt_upgradable_packages $upgradable
# HELP homelab_apt_security_upgradable_packages Of those, from a -security suite.
# TYPE homelab_apt_security_upgradable_packages gauge
homelab_apt_security_upgradable_packages $security
PROM
mv "$tmp" "$dir/host.prom"
