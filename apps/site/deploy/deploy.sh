#!/usr/bin/env bash
# Publish the homelab landing page: rsync public/ to the mini PC, (re)start nginx, check it.
# Usage: apps/site/deploy/deploy.sh   (DEPLOY_HOST defaults to the `homelab` ssh alias)
set -euo pipefail

cd "$(dirname "$0")/.."
HOST="${DEPLOY_HOST:-homelab}"
REMOTE_DIR="homelab-site"
URL="https://homelab.davideghiotto.it"

echo "› upload to $HOST:~/$REMOTE_DIR"
ssh "$HOST" "mkdir -p ~/$REMOTE_DIR/site"
rsync -az deploy/compose.yml deploy/nginx.conf "$HOST:~/$REMOTE_DIR/"
# --delay-updates swaps files in at the end, so visitors never get a half-written page.
rsync -az --delete --delay-updates --exclude .DS_Store public/ "$HOST:~/$REMOTE_DIR/site/"

echo "› start / reload nginx"
ssh "$HOST" "cd ~/$REMOTE_DIR && docker compose up -d --remove-orphans --wait && docker compose exec -T web nginx -s reload"

echo "› verify"
ssh "$HOST" "curl -fsS -o /dev/null -w 'local  %{http_code}\n' http://127.0.0.1:8803/"
curl -fsS -A curl/8 -o /dev/null -w "public %{http_code}\n" "$URL/" || echo "public check failed (tunnel/DNS?)"
echo "✓ $URL"
