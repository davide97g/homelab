#!/usr/bin/env bash
#
# Installs the two systemd units on the box, so the stack survives a reboot even
# if it was stopped, and a hung container gets restarted.
#
#   mediarr.service     brings the stack up at boot, from Dokploy's checkout
#   mediarr-heal.timer  runs heal.sh every minute
#
# Dokploy deploys the stack (app name `mediarr`), so both units use its checkout
# in /etc/dokploy/compose/mediarr/code/stacks/mediarr and never a copy of their
# own. heal.sh itself still lives in $DEPLOY_PATH.
#
# Needs sudo on the box, so run it from a terminal where you can type the
# password:
#
#   ./scripts/install-service.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "no .env -- cp .env.example .env"; exit 1; }
set -a; . ./.env; set +a

HOST=${DEPLOY_HOST:?}
DIR=${DEPLOY_PATH:?}
COMPOSE_DIR=/etc/dokploy/compose/mediarr/code/stacks/mediarr
# The unit runs as the box user that owns $DIR, not as root.
USER_ON_BOX=$(ssh "$HOST" id -un)

log() { printf '\033[38;5;154m▸\033[0m %s\n' "$*"; }

log "Shipping heal.sh"
ssh "$HOST" "mkdir -p '$DIR'"
COPYFILE_DISABLE=1 tar czf - -C scripts heal.sh | ssh "$HOST" "tar xzf - -C '$DIR' && chmod +x '$DIR/heal.sh'"

log "Installing units (sudo on $HOST -- expect a password prompt)"
ssh -t "$HOST" "sudo tee /etc/systemd/system/mediarr.service >/dev/null <<UNIT
[Unit]
Description=mediarr stack (Jellyseerr, Prowlarr, Radarr, Sonarr, qBittorrent)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=$USER_ON_BOX
WorkingDirectory=$COMPOSE_DIR
ExecStart=/usr/bin/docker compose -p mediarr --env-file .env -f compose.yml up -d
ExecStop=/usr/bin/docker compose -p mediarr --env-file .env -f compose.yml stop
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
UNIT
sudo tee /etc/systemd/system/mediarr-heal.service >/dev/null <<UNIT
[Unit]
Description=Restart hung or missing mediarr containers
After=mediarr.service

[Service]
Type=oneshot
User=$USER_ON_BOX
Environment=MEDIARR_COMPOSE_DIR=$COMPOSE_DIR
ExecStart=$DIR/heal.sh
UNIT
sudo tee /etc/systemd/system/mediarr-heal.timer >/dev/null <<UNIT
[Unit]
Description=Check mediarr container health every minute

[Timer]
OnBootSec=3min
OnUnitActiveSec=1min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now mediarr.service mediarr-heal.timer
systemctl status mediarr.service --no-pager | head -6
systemctl list-timers mediarr-heal.timer --no-pager"

log "Done"
