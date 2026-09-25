#!/usr/bin/env bash
#
# One command for the whole local stack: Jellyfin (Docker) + the Vite dev
# server. Run it with `bun run dev:all`.
#
# The point of the container juggling below is the external drive. A bind mount
# whose host path does not exist makes `docker start` fail outright:
#
#   error while creating mount source path '/host_mnt/Volumes/Untitled':
#   mkdir /host_mnt/Volumes/Untitled: permission denied
#
# Docker cannot add or drop a mount on an existing container, so the mount set
# is decided here, at startup, and the container is recreated when it changed.
# That costs nothing: /config and /cache live in named volumes, so the library,
# users and metadata all survive. With the drive unplugged the container comes
# up with only the local movies folder mounted -- Jellyfin still lists the
# drive's films from its database, and the app's stream probe shows them as
# offline instead of offering a dead Play button.
set -euo pipefail

cd "$(dirname "$0")/../.."

# .env is the single place to override any of this; vite.config.ts reads the
# same file for JELLYFIN_URL.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

CONTAINER=${JELLYFIN_CONTAINER:-jellyfin}
IMAGE=${JELLYFIN_IMAGE:-jellyfin/jellyfin:latest}
PORT=${JELLYFIN_PORT:-8096}
LOCAL_MEDIA=${LOCAL_MEDIA_PATH:-$HOME/Movies}
LOCAL_MOUNT=${LOCAL_MEDIA_MOUNT:-/media}
DRIVE_MEDIA=${DRIVE_MEDIA_PATH:-/Volumes/Untitled}
# Matches the path the existing library was configured with -- changing it
# orphans that library inside Jellyfin.
DRIVE_MOUNT=${DRIVE_MEDIA_MOUNT:-/mnt/toshiba}

log() { printf '\033[38;5;154m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[38;5;214m▸\033[0m %s\n' "$*"; }

docker info >/dev/null 2>&1 || {
  warn "Docker is not running. Start Docker Desktop and try again."
  exit 1
}

[ -d "$LOCAL_MEDIA" ] || {
  warn "Local media folder not found: $LOCAL_MEDIA (set LOCAL_MEDIA_PATH in .env)"
  exit 1
}

# --- mount set -------------------------------------------------------------
mounts=(-v jellyfin-config:/config -v jellyfin-cache:/cache
  -v "$LOCAL_MEDIA:$LOCAL_MOUNT:ro")
want="$LOCAL_MEDIA:$LOCAL_MOUNT|"

if [ -d "$DRIVE_MEDIA" ]; then
  mounts+=(-v "$DRIVE_MEDIA:$DRIVE_MOUNT:ro")
  want+="$DRIVE_MEDIA:$DRIVE_MOUNT|"
  log "External drive present: $DRIVE_MEDIA"
else
  warn "External drive absent ($DRIVE_MEDIA) -- serving $LOCAL_MEDIA only."
fi

# --- container -------------------------------------------------------------
# Docker Desktop reports bind sources prefixed with /host_mnt; strip it so the
# comparison is against the paths this script asked for.
have=$(docker inspect -f \
  '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}}:{{.Destination}}|{{end}}{{end}}' \
  "$CONTAINER" 2>/dev/null | sed 's|/host_mnt||g' || true)
exists=$(docker ps -aq --filter "name=^${CONTAINER}$")

if [ -n "$exists" ] && [ "$have" = "$want" ]; then
  if [ -z "$(docker ps -q --filter "name=^${CONTAINER}$")" ]; then
    log "Starting existing $CONTAINER"
    docker start "$CONTAINER" >/dev/null
  else
    log "$CONTAINER already running"
  fi
else
  if [ -n "$exists" ]; then
    log "Mounts changed -- recreating $CONTAINER (config and metadata are in volumes)"
    docker rm -f "$CONTAINER" >/dev/null
  else
    log "Creating $CONTAINER"
  fi
  docker run -d --name "$CONTAINER" --restart unless-stopped \
    -p "$PORT:8096" "${mounts[@]}" "$IMAGE" >/dev/null
fi

# --- wait for the API ------------------------------------------------------
log "Waiting for Jellyfin on http://localhost:$PORT"
for _ in $(seq 1 60); do
  if curl -sf "http://localhost:$PORT/System/Info/Public" >/dev/null; then
    log "Jellyfin up"
    break
  fi
  if [ -z "$(docker ps -q --filter "name=^${CONTAINER}$")" ]; then
    warn "Container died. Last lines:"
    docker logs --tail 20 "$CONTAINER" || true
    exit 1
  fi
  sleep 1
done

# --- front end -------------------------------------------------------------
# Ctrl+C stops Vite; Jellyfin keeps running (`docker stop jellyfin` to stop it).
log "Starting Vite"
exec bun run dev
