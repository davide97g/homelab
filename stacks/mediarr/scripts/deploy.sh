#!/usr/bin/env bash
#
# Operate the stack on the box. Deploying is a push to main: Dokploy's `mediarr`
# app clones davide97g/homelab and runs compose from its checkout, with the
# secrets from its Environment tab. This script works on that same checkout, so
# nothing it does can bring back an older compose file.
#
#   ./scripts/deploy.sh          ask Dokploy to deploy main now (needs .dokploy.env)
#   ./scripts/deploy.sh pull     pull images, then up -d
#   ./scripts/deploy.sh down     stop the stack, keep the volumes
#   ./scripts/deploy.sh logs     follow
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=${DEPLOY_HOST:-homelab}
DIR=/etc/dokploy/compose/mediarr/code/stacks/mediarr
COMPOSE="docker compose -p mediarr --env-file .env -f compose.yml"
ACTION=${1:-up}

log() { printf '\033[38;5;154m▸\033[0m %s\n' "$*"; }

case "$ACTION" in
  up)
    [ -f .dokploy.env ] || { echo "no .dokploy.env (DOKPLOY_URL, DOKPLOY_API_KEY, DOKPLOY_COMPOSE_ID)"; exit 1; }
    set -a; . ./.dokploy.env; set +a
    log "Asking Dokploy to deploy main"
    curl -fsS -X POST -H "x-api-key: $DOKPLOY_API_KEY" -H 'content-type: application/json' \
      -d "{\"composeId\":\"$DOKPLOY_COMPOSE_ID\",\"title\":\"manual deploy.sh\"}" "$DOKPLOY_URL/api/compose.deploy" ;;
  pull) log "Pulling";       ssh "$HOST" "cd '$DIR' && $COMPOSE pull && $COMPOSE up -d" ;;
  down) log "Stopping";      ssh "$HOST" "cd '$DIR' && $COMPOSE down" ;;
  logs) ssh -t "$HOST" "cd '$DIR' && $COMPOSE logs -f" ;;
  *)    ssh -t "$HOST" "cd '$DIR' && $COMPOSE $*" ;;
esac
