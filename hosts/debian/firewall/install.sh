#!/usr/bin/env bash
# Install homelab-firewall on the mini PC. Run as root from a copy of this folder:
#   sudo ./install.sh
# It takes the config from ./homelab-firewall.conf (not committed) or an existing
# /etc/default/homelab-firewall, installs the script and its unit, applies the
# DOCKER-USER allowlist, puts Tailscale in nodivert mode so UFW governs tailscale0,
# then narrows UFW's blanket "allow in on tailscale0" to the trusted tailnet
# devices. Nothing here touches SSH over the LAN.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }
here=$(cd "$(dirname "$0")" && pwd)

if [ -f "$here/homelab-firewall.conf" ]; then
  install -m 0644 "$here/homelab-firewall.conf" /etc/default/homelab-firewall
elif [ ! -f /etc/default/homelab-firewall ]; then
  install -m 0644 "$here/homelab-firewall.conf.example" /etc/default/homelab-firewall
  echo "fill in /etc/default/homelab-firewall, then run this again" >&2
  exit 1
fi
# shellcheck source=/dev/null
. /etc/default/homelab-firewall

install -m 0755 "$here/homelab-firewall" /usr/local/sbin/homelab-firewall
install -m 0644 "$here/homelab-firewall.service" /etc/systemd/system/homelab-firewall.service
systemctl daemon-reload
systemctl enable homelab-firewall.service
systemctl restart homelab-firewall.service

# Tailscale puts its own ts-input first in INPUT, and that chain accepts every
# packet on tailscale0 before UFW sees it -- so the UFW rules below would change
# nothing for tailnet peers. nodivert keeps Tailscale's chains but drops the
# jump, leaving UFW to decide. WireGuard's port, which ts-input also accepted,
# is opened explicitly so direct peer connections do not fall back to DERP.
tailscale set --netfilter-mode=nodivert
ufw allow 41641/udp comment 'tailscale: wireguard'

# Host services (SSH, Swarm's 2377/7946, and Docker's userland proxy on [::],
# which is how IPv6 reaches published ports) go through INPUT, where UFW let the
# whole tailnet in. Allow the trusted devices first, then drop the blanket rule.
for ip in $TRUSTED_V4 ${TRUSTED_V6:-}; do
  ufw allow in on tailscale0 from "$ip" comment 'homelab-firewall: trusted tailnet device'
done
ufw delete allow in on tailscale0 || true

echo
homelab-firewall status
echo
ufw status verbose
