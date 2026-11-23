#!/usr/bin/env bash
# The sudo half of the 2026-09-25 audit (docs/security/), plus the pending upgrades.
# Run by hand, with a second ssh session open in case sshd refuses the new config:
#   scp hosts/debian/hardening/apply.sh homelab:ops/apply-hardening.sh && ssh -t homelab 'sudo bash ~/ops/apply-hardening.sh'
# Idempotent. Ends with a reboot prompt.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }

echo "› sshd: keys only, no X11 forwarding"
# Debian's sshd_config Includes sshd_config.d/*.conf on line 12, before its own
# settings, and the first value sshd reads wins -- so this file overrides them.
cat >/etc/ssh/sshd_config.d/10-homelab.conf <<'CONF'
# Managed by the homelab repo, hosts/debian/hardening/apply.sh
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
X11Forwarding no
CONF
sshd -t
systemctl reload ssh
sshd -T | grep -E '^(passwordauthentication|x11forwarding|permitrootlogin) '

echo "› kernel: hide kernel pointers from unprivileged users"
echo 'kernel.kptr_restrict = 1' >/etc/sysctl.d/90-homelab-hardening.conf
sysctl -q --system
sysctl kernel.kptr_restrict

echo "› packages: full upgrade (Docker included -- the stacks restart with it)"
apt-get update -q
DEBIAN_FRONTEND=noninteractive apt-get -y -q full-upgrade
apt-get -y -q autoremove

if [ -e /var/run/reboot-required ]; then
  echo "› a reboot is required ($(cat /var/run/reboot-required.pkgs 2>/dev/null | tr '\n' ' '))"
  read -r -p "reboot now? [y/N] " a
  [ "$a" = y ] && systemctl reboot
fi
