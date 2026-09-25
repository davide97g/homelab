#!/usr/bin/env bash
#
# Push compose.yml and .env to the box and bring the stack up.
#
#   ./scripts/deploy.sh          up -d
#   ./scripts/deploy.sh pull     pull images, then up -d
#   ./scripts/deploy.sh down     stop the stack, keep the volumes
#   ./scripts/deploy.sh logs     follow
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "no .env -- cp .env.example .env"; exit 1; }
set -a; . ./.env; set +a

HOST=${DEPLOY_HOST:?}
DIR=${DEPLOY_PATH:?}
ACTION=${1:-up}

log() { printf '\033[38;5;154m▸\033[0m %s\n' "$*"; }

log "Syncing to $HOST:$DIR"
ssh "$HOST" "mkdir -p '$DIR' '$MEDIA_ROOT'/torrents '$MEDIA_ROOT'/library/movies '$MEDIA_ROOT'/library/tv"
# tar over ssh rather than rsync -- the box has no rsync.
COPYFILE_DISABLE=1 tar czf - compose.yml .env | ssh "$HOST" "tar xzf - -C '$DIR'"

case "$ACTION" in
  up)   log "Starting";      ssh "$HOST" "cd '$DIR' && docker compose up -d" ;;
  pull) log "Pulling";       ssh "$HOST" "cd '$DIR' && docker compose pull && docker compose up -d" ;;
  down) log "Stopping";      ssh "$HOST" "cd '$DIR' && docker compose down" ;;
  logs) ssh -t "$HOST" "cd '$DIR' && docker compose logs -f" ;;
  *)    ssh -t "$HOST" "cd '$DIR' && docker compose $*" ;;
esac
