#!/usr/bin/env bash
#
# Runs on the box, once a minute, from mediarr-heal.timer.
#
# Docker's `restart: unless-stopped` only reacts to a process exiting. A
# qBittorrent that is still running but has stopped answering its Web UI keeps
# the container "up" forever. The compose healthchecks catch that; this turns an
# unhealthy verdict into a restart, and puts back anything that has gone missing
# entirely (someone ran `docker compose down`, a container was removed).
#
# The stack is deployed by Dokploy (app name `mediarr`, so the compose project is
# still `mediarr`), and the only up-to-date compose file and .env on the box are
# its checkout. A stopped container is therefore just started again; compose runs
# only when one is missing, and then from that checkout -- never from a copy of
# its own, which would recreate the stack from whatever that copy last said.
set -uo pipefail

COMPOSE_DIR=${MEDIARR_COMPOSE_DIR:-/etc/dokploy/compose/mediarr/code/stacks/mediarr}
SERVICES=(jellyseerr jellyfin prowlarr radarr sonarr qbittorrent)

for c in "${SERVICES[@]}"; do
  state=$(docker inspect -f \
    '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}nohealth{{end}}{{else}}stopped{{end}}' \
    "$c" 2>/dev/null) || state=missing

  case "$state" in
    unhealthy)
      logger -t mediarr-heal "restarting $c (unhealthy)"
      docker restart "$c" >/dev/null 2>&1
      ;;
    stopped)
      logger -t mediarr-heal "starting $c (stopped)"
      docker start "$c" >/dev/null 2>&1
      ;;
    missing)
      logger -t mediarr-heal "$c is missing -- compose up from the Dokploy checkout"
      (cd "$COMPOSE_DIR" && docker compose -p mediarr --env-file .env -f compose.yml up -d) >/dev/null 2>&1
      break   # one `compose up` fixes every missing service at once
      ;;
  esac
done
