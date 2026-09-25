#!/usr/bin/env bash
#
# Runs on the box, once a minute, from mediarr-heal.timer.
#
# Docker's `restart: unless-stopped` only reacts to a process exiting. A
# qBittorrent that is still running but has stopped answering its Web UI keeps
# the container "up" forever. The compose healthchecks catch that; this turns an
# unhealthy verdict into a restart, and puts back anything that has gone missing
# entirely (someone ran `docker compose down`, a container was removed).
set -uo pipefail

DIR=${MEDIARR_DIR:-/home/davide/mediarr}
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
    stopped|missing)
      logger -t mediarr-heal "$c is $state -- compose up"
      (cd "$DIR" && docker compose up -d) >/dev/null 2>&1
      break   # one `compose up` fixes every missing service at once
      ;;
  esac
done
