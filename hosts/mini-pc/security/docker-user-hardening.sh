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
# The tailnet has two users: the owner (this box + the Mac) and the NAS owner
# (<nas-owner-email>: the NAS DXP4800PRO + an iPhone). All homelab flows
# run debian -> NAS (xfer, Jellyfin, ssh), which is OUTBOUND from this box and NOT
# affected here. This drops the other user's devices when they try to reach any
# published container port ON this box, over the tailnet, while leaving the owner's Mac
# and the LAN untouched. Host SSH (:22) is not a container port, so the
# NAS can still SSH in.
#
# The addresses to drop come from /etc/default/docker-user-hardening (copy
# docker-user-hardening.conf.example there): tailnet addresses stay out of this repo.
#
# Idempotent: safe to re-run. Run as root:  sudo bash docker-user-hardening.sh
set -euo pipefail

CONF=${DOCKER_USER_HARDENING_CONF:-/etc/default/docker-user-hardening}
# shellcheck source=/dev/null
. "$CONF"

IFACE="tailscale0"

# The NAS owner's devices, space-separated in the config.
read -r -a V4 <<<"${UNTRUSTED_V4:-}"
read -r -a V6 <<<"${UNTRUSTED_V6:-}"
if [ "${#V4[@]}" -eq 0 ] && [ "${#V6[@]}" -eq 0 ]; then
  echo "No UNTRUSTED_V4/UNTRUSTED_V6 in $CONF, nothing to drop." >&2
  exit 1
fi

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
