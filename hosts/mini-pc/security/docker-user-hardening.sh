#!/usr/bin/env bash
#
# Gate Docker-published ports on the mini PC (debian) against the *other* Tailscale
# user's devices.
#
# Why this and not UFW: UFW is enabled on the box (default-deny INPUT), but Docker's
# `-p` publishing writes rules into the nat/DOCKER iptables chains that are evaluated
# BEFORE UFW's INPUT chain, so every published container port bypasses UFW entirely.
# The DOCKER-USER chain, however, IS evaluated for traffic forwarded to those ports,
# so this is the correct place to filter them.
#
# The tailnet (tail740ca3.ts.net) has two users: ghiotto.davidenko@gmail.com (this box
# + the Mac) and ilai5800@gmail.com (the NAS DXP4800PRO + an iPhone). All homelab flows
# run debian -> NAS (xfer, Jellyfin, ssh), which is OUTBOUND from this box and NOT
# affected here. This drops the other user's devices when they try to reach any
# published container port ON this box, over the tailnet, while leaving the owner's Mac
# (100.75.65.38) and the LAN untouched. Host SSH (:22) is not a container port, so the
# NAS can still SSH in.
#
# Idempotent: safe to re-run. Run as root:  sudo bash docker-user-hardening.sh
set -euo pipefail

IFACE="tailscale0"

# ilai5800@gmail.com devices. Update if that user adds/removes devices
# (`tailscale status` shows current IPs).
V4=(100.81.127.95 100.69.150.104)                                # NAS, iPhone
V6=(fd7a:115c:a1e0::d131:7f60 fd7a:115c:a1e0::2631:9669)         # NAS, iPhone

ins() {  # $1=binary  $2=source-address
  # Insert at the top of DOCKER-USER, but only if an identical rule is not already there.
  "$1" -C DOCKER-USER -i "$IFACE" -s "$2" -j DROP 2>/dev/null \
    || "$1" -I DOCKER-USER -i "$IFACE" -s "$2" -j DROP
}

for a in "${V4[@]}"; do ins iptables  "$a"; done
for a in "${V6[@]}"; do ins ip6tables "$a"; done

echo "DOCKER-USER hardening applied for ${#V4[@]} IPv4 + ${#V6[@]} IPv6 sources on ${IFACE}."
echo "Current DOCKER-USER (v4):"
iptables -L DOCKER-USER -n -v --line-numbers
