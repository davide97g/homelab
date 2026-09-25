#!/usr/bin/env bash
#
# Run one of the Python helpers on the box.
#
#   ./scripts/on-box.sh bazarr-setup.py
#   ./scripts/on-box.sh jellyseerr-repoint.py <jellyfin-api-key> <jellyfin-url>
#   ./scripts/on-box.sh jellyseerr-telegram.py <bot-token> [chat-id]
#
# These talk to APIs that are only published on the box's LAN interface, and
# read keys out of the containers themselves, so they have to execute there.
# The file is piped over SSH rather than installed -- nothing to keep in sync,
# and the repo stays the only copy.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "no .env -- cp .env.example .env"; exit 1; }
set -a; . ./.env; set +a

HOST=${DEPLOY_HOST:?}
SCRIPT=${1:?usage: on-box.sh <script.py> [args...]}
shift

[ -f "scripts/$SCRIPT" ] || { echo "no such script: scripts/$SCRIPT"; exit 1; }

printf '\033[38;5;154m▸\033[0m %s on %s\n' "$SCRIPT" "$HOST"
# `python3 -` reads the program from stdin and still passes the rest as argv.
ssh "$HOST" "python3 - $*" < "scripts/$SCRIPT"
