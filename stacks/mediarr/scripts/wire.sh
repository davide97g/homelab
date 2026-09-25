#!/usr/bin/env bash
#
# Everything in Radarr, Sonarr and Prowlarr that is the same every time: root
# folders, Prowlarr's two app links, and qBittorrent as the download client.
# Idempotent -- re-running it skips whatever already exists.
#
#   ./scripts/wire.sh                       root folders + Prowlarr apps
#   QBIT_PASS=... ./scripts/wire.sh         the above, plus the download client
#
# Not covered, because both need a human: indexers in Prowlarr, and the
# Jellyfin/Radarr/Sonarr entries in the Jellyseerr wizard.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "no .env -- cp .env.example .env"; exit 1; }
set -a; . ./.env; set +a

HOST=${DEPLOY_HOST:?}
DIR=${DEPLOY_PATH:?}
QBIT_USER=${QBIT_USER:-admin}
QBIT_PASS=${QBIT_PASS:-}

log() { printf '\033[38;5;154m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[38;5;214m▸\033[0m %s\n' "$*"; }

# The apps are only published on the box's LAN interface, so every call is made
# from the box itself over SSH rather than from here.
on_box() { ssh "$HOST" "$@"; }

key() { on_box "docker exec $1 sh -c 'grep -o \"<ApiKey>[^<]*\" /config/config.xml | cut -d\\> -f2'" | tr -d '\r'; }

api() { # api <method> <url> <apikey> [body]
  local m=$1 url=$2 k=$3 body=${4:-}
  if [ -n "$body" ]; then
    on_box "curl -sS -X $m '$url' -H 'X-Api-Key: $k' -H 'Content-Type: application/json' -d '$(printf '%s' "$body" | sed "s/'/'\\\\''/g")'"
  else
    on_box "curl -sS -X $m '$url' -H 'X-Api-Key: $k'"
  fi
}

log "Reading API keys"
RADARR_KEY=$(key radarr)
SONARR_KEY=$(key sonarr)
PROWLARR_KEY=$(key prowlarr)
printf '  radarr   %s\n  sonarr   %s\n  prowlarr %s\n' "$RADARR_KEY" "$SONARR_KEY" "$PROWLARR_KEY"

# --- root folders ----------------------------------------------------------
add_root() { # add_root <app> <port> <key> <path>
  if api GET "http://localhost:$2/api/v3/rootFolder" "$3" | grep -q "\"$4\""; then
    log "$1 root folder already set"
  else
    log "$1 root folder $4"
    api POST "http://localhost:$2/api/v3/rootFolder" "$3" "{\"path\":\"$4\"}" >/dev/null
  fi
}
add_root radarr 7878 "$RADARR_KEY" /data/library/movies
add_root sonarr 8989 "$SONARR_KEY" /data/library/tv

# --- Prowlarr -> Radarr / Sonarr -------------------------------------------
apps=$(api GET "http://localhost:9696/api/v1/applications" "$PROWLARR_KEY")
add_app() { # add_app <name> <baseUrl> <key> <json-fields>
  if printf '%s' "$apps" | grep -q "\"name\": *\"$1\""; then
    log "Prowlarr already knows $1"
  else
    log "Prowlarr -> $1"
    api POST "http://localhost:9696/api/v1/applications" "$PROWLARR_KEY" \
      "{\"name\":\"$1\",\"implementation\":\"$1\",\"implementationName\":\"$1\",\"configContract\":\"${1}Settings\",\"syncLevel\":\"fullSync\",\"tags\":[],\"fields\":[{\"name\":\"prowlarrUrl\",\"value\":\"http://prowlarr:9696\"},{\"name\":\"baseUrl\",\"value\":\"$2\"},{\"name\":\"apiKey\",\"value\":\"$3\"},$4]}" >/dev/null
  fi
}
add_app Radarr http://radarr:7878 "$RADARR_KEY" \
  '{"name":"syncCategories","value":[2000,2010,2020,2030,2040,2045,2050,2060,2070,2080,2090]}'
add_app Sonarr http://sonarr:8989 "$SONARR_KEY" \
  '{"name":"syncCategories","value":[5000,5010,5020,5030,5040,5045,5050,5090]},{"name":"animeSyncCategories","value":[5070]}'

# --- qBittorrent as download client ----------------------------------------
if [ -z "$QBIT_PASS" ]; then
  warn "QBIT_PASS not set -- skipping the download client."
  warn "Set a password in qBittorrent (Options -> Web UI), then:"
  warn "  QBIT_PASS=yourpassword $0"
  exit 0
fi

add_client() { # add_client <app> <port> <key> <category>
  if api GET "http://localhost:$2/api/v3/downloadclient" "$3" | grep -q '"qBittorrent"'; then
    log "$1 already has a qBittorrent client"
    return
  fi
  log "$1 -> qBittorrent"
  api POST "http://localhost:$2/api/v3/downloadclient" "$3" \
    "{\"enable\":true,\"protocol\":\"torrent\",\"priority\":1,\"name\":\"qBittorrent\",\"implementation\":\"QBittorrent\",\"implementationName\":\"qBittorrent\",\"configContract\":\"QBittorrentSettings\",\"tags\":[],\"fields\":[{\"name\":\"host\",\"value\":\"qbittorrent\"},{\"name\":\"port\",\"value\":8080},{\"name\":\"useSsl\",\"value\":false},{\"name\":\"username\",\"value\":\"$QBIT_USER\"},{\"name\":\"password\",\"value\":\"$QBIT_PASS\"},{\"name\":\"movieCategory\",\"value\":\"$4\"},{\"name\":\"tvCategory\",\"value\":\"$4\"}]}" >/dev/null
}
add_client radarr 7878 "$RADARR_KEY" radarr
add_client sonarr 8989 "$SONARR_KEY" sonarr

log "Done"
