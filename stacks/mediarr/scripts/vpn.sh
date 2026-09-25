#!/usr/bin/env bash
#
# qBittorrent behind gluetun (ProtonVPN). Two jobs, both run from here over SSH.
#
#   QBIT_PASS=... ./scripts/vpn.sh prep    before the first VPN deploy: turn on
#                                          bypass_local_auth, which gluetun's
#                                          port-forward command needs
#   ./scripts/vpn.sh check                 after it: prove nothing leaks
#
# `check` exits non-zero on any failure, so it is safe to script.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "no .env -- cp .env.example .env"; exit 1; }
set -a; . ./.env; set +a

HOST=${DEPLOY_HOST:?}
QBIT_USER=${QBIT_USER:-admin}
QBIT_PASS=${QBIT_PASS:-}

log() { printf '\033[38;5;154m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[38;5;214m▸\033[0m %s\n' "$*"; }
fail() { printf '\033[38;5;203m✗\033[0m %s\n' "$*"; FAILED=1; }
on_box() { ssh "$HOST" "$@"; }

prep() {
  [ -n "$QBIT_PASS" ] || { warn "QBIT_PASS=... ./scripts/vpn.sh prep"; exit 1; }
  # Through the WebUI API, never qBittorrent.conf: qBittorrent rewrites that file
  # about a minute after start and drops keys it did not write itself.
  # The script goes over stdin, so the password is never on a command line and
  # the JSON's quotes do not have to survive two shells.
  log "qBittorrent: bypass_local_auth on"
  on_box "docker exec -i qbittorrent sh -s" <<EOF
set -e
trap 'rm -f /tmp/qb.cookie' EXIT
# A wrong password is a 401 (-f fails on it). Success is judged by the SID
# cookie, not the body: 5.2 no longer answers "Ok.".
curl -fsS -o /dev/null -c /tmp/qb.cookie --data-urlencode 'username=$QBIT_USER' --data-urlencode 'password=$QBIT_PASS' \
  http://localhost:8080/api/v2/auth/login
grep -q SID /tmp/qb.cookie || { echo "login gave no session cookie"; exit 1; }
curl -fsS -b /tmp/qb.cookie --data-urlencode 'json={"bypass_local_auth":true}' \
  http://localhost:8080/api/v2/app/setPreferences
curl -fsS -b /tmp/qb.cookie http://localhost:8080/api/v2/app/preferences | grep -o '"bypass_local_auth":[a-z]*'
EOF
}

check() {
  FAILED=0

  log "gluetun"
  health=$(on_box "docker inspect -f '{{.State.Health.Status}}' gluetun" 2>/dev/null || echo missing)
  [ "$health" = healthy ] && echo "  healthy" || fail "gluetun is $health"

  log "Exit IP"
  home=$(on_box "curl -fsS --max-time 10 https://ipinfo.io/ip" || true)
  vpn=$(on_box "docker exec qbittorrent curl -fsS --max-time 10 https://ipinfo.io/ip" || true)
  printf '  box      %s\n  torrents %s\n' "${home:-?}" "${vpn:-?}"
  if [ -z "$vpn" ]; then fail "qBittorrent has no way out (tunnel down, or stale namespace)"
  elif [ "$vpn" = "$home" ]; then fail "qBittorrent exits on the home IP -- the VPN is NOT in the path"
  fi

  log "Forwarded port vs qBittorrent"
  fwd=$(on_box "docker logs gluetun 2>&1 | grep -oE 'port forwarded is [0-9]+' | tail -1 | grep -oE '[0-9]+'" || true)
  prefs=$(on_box "docker exec qbittorrent curl -fsS http://127.0.0.1:8080/api/v2/app/preferences" || true)
  listen=$(printf '%s' "$prefs" | grep -oE '"listen_port":[0-9]+' | cut -d: -f2)
  iface=$(printf '%s' "$prefs" | grep -oE '"current_network_interface":"[^"]*"' | cut -d'"' -f4)
  printf '  gluetun  %s\n  qbit     %s on %s\n' "${fwd:-?}" "${listen:-?}" "${iface:-?}"
  [ -n "$prefs" ] || fail "qBittorrent API refused a localhost call -- run: QBIT_PASS=... $0 prep"
  [ -n "$fwd" ] || fail "gluetun has not logged a forwarded port"
  [ -n "$fwd" ] && [ "$fwd" != "$listen" ] && fail "listen port does not match the forwarded one"
  [ "$iface" = tun0 ] || fail "qBittorrent is not bound to tun0"

  echo
  if [ "$FAILED" = 0 ]; then
    log "All good. For a torrent-level test, add the magnet from https://ipleak.net (Torrent Address detection)."
  else
    exit 1
  fi
}

case ${1:-} in
  prep) prep ;;
  check) check ;;
  *) echo "usage: $0 prep|check"; exit 1 ;;
esac
