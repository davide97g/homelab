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
# asked for. NONINTERACTIVE=1 asks nothing and generates what it can.
#
# Right now the hub is read-only, so this is short. It grows when the actions
# layer lands and needs the *arr keys, the qBittorrent login and the Dokploy
# token -- at which point the extraction logic in mediarr-dash's
# scripts/collect-env.sh is the thing to copy, since it already works.

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
    read -rsp "  $prompt: " answer
    echo
  else
    read -rp "  $prompt: " answer
  fi
  ENV["$key"]="$answer"
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

{
  echo "# Written by scripts/collect-env.sh on $(date -Is). Mode 600, never in git."
  for key in "${!ENV[@]}"; do
    echo "${key}=${ENV[$key]}"
  done
} > "$TARGET"

chmod 600 "$TARGET"
echo "wrote $TARGET"
