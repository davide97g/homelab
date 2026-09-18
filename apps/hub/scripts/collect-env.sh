#!/usr/bin/env bash
# Writes /home/davide/hub/.env, mode 600.
#
# This runs ON THE BOX, never on a laptop and never inside an agent session. The
# secrets it handles are read out of running containers or typed in here, and
# they must not travel anywhere else.
#
#     ssh -t homelab 'bash ~/hub/scripts/collect-env.sh'
#
# Re-running is safe: existing answers are kept and only what is missing is
# asked for. NONINTERACTIVE=1 asks nothing and generates what it can, which is
# the right form for a re-run after a deploy.
#
# Everything the actions layer needs is optional. A blank key does not break the
# hub: the action it belongs to reports itself `unavailable` with the reason, so
# an uncollected credential is a greyed-out button rather than a failure at the
# click.

set -euo pipefail
umask 077

TARGET="${HOME}/hub/.env"
mkdir -p "$(dirname "$TARGET")"

declare -A ENV=()
if [[ -f "$TARGET" ]]; then
  while IFS='=' read -r key value; do
    [[ -z "$key" || "$key" == \#* ]] && continue
    ENV["$key"]="$value"
  done < "$TARGET"
  echo "found an existing $TARGET — keeping what is already set"
fi

mask() { local v="$1"; [[ -z "$v" ]] && echo "(empty)" || echo "${v:0:4}…${v: -2} (${#v} chars)"; }

ask() {
  local key="$1" prompt="$2" secret="${3:-}"
  local current="${ENV[$key]:-}"

  if [[ -n "$current" ]]; then
    echo "  $key: already set, keeping it"
    return
  fi
  if [[ -n "${NONINTERACTIVE:-}" ]]; then
    echo "  $key: not set and running non-interactively — leaving blank"
    return
  fi

  local answer
  if [[ -n "$secret" ]]; then
    read -rsp "  $prompt: " answer </dev/tty
    echo
  else
    read -rp "  $prompt: " answer </dev/tty
  fi
  ENV["$key"]="$answer"
}

# Read a value straight out of a running container. Copied in spirit from
# mediarr-dash's collect-env.sh, which already does this and works: every *arr
# keeps its API key in its own config file, so the key never has to be typed and
# never travels anywhere.
from_container() {
  local container="$1"; shift
  docker exec "$container" "$@" 2>/dev/null | tr -d '\r\n' || true
}

refresh_from_container() {
  local key="$1" container="$2"; shift 2
  local value
  value="$(from_container "$container" "$@")"
  if [[ -n "$value" ]]; then
    ENV["$key"]="$value"
    echo "  $key: read from $container  $(mask "$value")"
  elif [[ -n "${ENV[$key]:-}" ]]; then
    echo "  $key: $container did not answer — keeping what is already set"
  else
    echo "  $key: $container did not answer and nothing is set — that action stays unavailable"
  fi
}

echo "hub environment"

# The one thing the server refuses to start without.
if [[ -z "${ENV[HUB_PASSWORD]:-}" && -n "${NONINTERACTIVE:-}" ]]; then
  ENV[HUB_PASSWORD]="$(openssl rand -hex 12)"
  echo "  HUB_PASSWORD: generated — read it back out of $TARGET"
else
  ask HUB_PASSWORD "password for the hub" secret
fi

# Preserved on purpose across runs: rotating it logs every session out, which is
# a thing to do deliberately rather than by accident on a redeploy.
if [[ -z "${ENV[SESSION_SECRET]:-}" ]]; then
  ENV[SESSION_SECRET]="$(openssl rand -hex 32)"
  echo "  SESSION_SECRET: generated"
else
  echo "  SESSION_SECRET: already set, keeping it"
fi

# Set this to true once the tunnel fronts the hub. Note the consequence: a
# browser will not store a Secure cookie over plain HTTP, so http://<box>:3003
# can no longer log in and verification moves to the box itself.
ENV[COOKIE_SECURE]="${ENV[COOKIE_SECURE]:-false}"

# The socket proxy runs as nobody and needs the host's docker group to read the
# socket. The gid is host-specific, so it is read here rather than baked into the
# compose file -- the same rule as every address in this repo.
DOCKER_GID_NOW="$(getent group docker | cut -d: -f3 || true)"
if [[ -n "$DOCKER_GID_NOW" ]]; then
  ENV[DOCKER_GID]="$DOCKER_GID_NOW"
  echo "  DOCKER_GID: $DOCKER_GID_NOW (this host's docker group)"
else
  echo "  DOCKER_GID: no docker group found — the socket proxy will not be able to read the socket"
fi

echo
echo "media write actions — keys are read out of the containers, not typed"
refresh_from_container RADARR_API_KEY radarr sed -n 's:.*<ApiKey>\(.*\)</ApiKey>.*:\1:p' /config/config.xml
refresh_from_container SONARR_API_KEY sonarr sed -n 's:.*<ApiKey>\(.*\)</ApiKey>.*:\1:p' /config/config.xml

echo
echo "qBittorrent — its Web UI login cannot be read from the container"
ask QBITTORRENT_USER "qBittorrent username (blank if auth is bypassed for this subnet)"
ask QBITTORRENT_PASS "qBittorrent password" secret

echo
echo "Dokploy redeploy — optional, and the most dangerous thing here"
echo "  Dokploy has no scoped tokens: this key can delete every service on the box."
echo "  DOKPLOY_ALLOW is what keeps it to the apps you name, as label=composeId"
echo "  pairs separated by commas. Leave the key blank to keep redeploy off."
ask DOKPLOY_API_KEY "Dokploy API key (Settings → API/CLI)" secret
ask DOKPLOY_ALLOW "allow-list, e.g. monitoring=abc123,hub=def456"

{
  echo "# Written by scripts/collect-env.sh on $(date -Is). Mode 600, never in git."
  for key in "${!ENV[@]}"; do
    echo "${key}=${ENV[$key]}"
  done
} > "$TARGET"

chmod 600 "$TARGET"
echo
echo "wrote $TARGET"
echo "restart the hub to pick it up:  cd ~/hub && docker compose up -d"
